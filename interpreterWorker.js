// import {Interpreter} from "./interpreter.js"
import {transform, transformFromAst, availablePlugins} from "@babel/standalone"
import template from "@babel/template"
import * as parser from "@babel/parser"
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import * as babelType from "@babel/types";
import {SourceMapConsumer} from "source-map"
import mergeSourceMap from "merge-source-map"
import ErrorStackParser from "error-stack-parser"
import LineColumnFinder from "line-column"
import DeepDiff from "deep-diff"

const workerID = Math.random()*100
var makeLogger = (prefix, consoleObj)=> {
  var context = [`%c${prefix}:`, "font-weight:bold;"]
  var props = ["log", "warn", "error"]
  var out = {}
  props.forEach(prop => {
    var f = Function.prototype.bind.call(consoleObj[prop], consoleObj, ...context);
    out[prop] = f
  })
  return out
}
const shortID = String(workerID).slice(0,2)
var workerLogger = makeLogger(`Worker ${String(workerID).slice(0,2)}`, console)
console = {...console, ...workerLogger}

// GLOBALS
// Full state includes below as well as DOM state, so fully resetting state is done by reloading the page
var workerState = {}

// codeVersionID is added to all getWidgetInstance calls

var baseTransformPlugin = ({widgetClassList, getWidgetInstance, codeSnippetID, options}) => {
  // const console = {...console, log: () => {}} // Disable Logging
  var visitor = {
    Program: {
      enter(path) {
        // Return only the first expression, so that the generated code can be used in the following way: var x = eval(generatedCode)
        if (options?.returnFirstExpression && !path.node.alreadyProcessed) {
          var firstExpression

          // TODO: Looks like AST can be parsed in multiple ways
          var candidates = [path.node.body?.[0], path.node.body?.[0]?.expression, path.node.body?.[0]?.declarations?.[0]?.init]
          for (let candidate of candidates) {
            if (babelType.isExpression(candidate)) {
              firstExpression = candidate
              break
            } else if (babelType.isFunctionDeclaration(candidate)) {
              // Convert to function expression (like wrapping a fn in parenthesis)
              firstExpression = babelType.functionExpression(candidate.id, candidate.params, candidate.body, candidate.generator, candidate.async)
              break
            }
          }
          if (!firstExpression) {
            console.log("Couldn't parse:",path.node)
            throw new Error("Couldn't parse code referenced by handler: \n" + generate(path.node).code)
          }

          firstExpression.ignoreNode = true
          const statement = babelType.expressionStatement(firstExpression)
          statement.ignoreNode = true
          const newProgram = babelType.program([statement], path.node.directives, path.node.sourceType, path.node.interpreter)
          path.replaceWith(newProgram)
          newProgram.alreadyProcessed = true
        }
      },
      exit(path) {
        var sourceURLComment = {
            type: "BlockComment",
            value: `@ sourceURL=${codeSnippetID}`
        };
        const programNode = path.node
        programNode.trailingComments = programNode.trailingComments || []
        programNode.trailingComments.push(sourceURLComment)
      }
    },
    ImportDeclaration: {
      enter(path) {
        const start=Date.now()

        var generateCodeForSpecifier = (node, moduleUID) => {
          var codeLine
          var localName = node.local.name
          if (node.type == "ImportNamespaceSpecifier") {
            codeLine = `var ${localName} = ${moduleUID}`
          }
          else {
            var importedName
            if (node.type == "ImportDefaultSpecifier") {
              importedName = "default"
            } else if (node.type == "ImportSpecifier") {
              importedName = node.imported.name
            }
            codeLine = `var ${localName} = ${moduleUID}.${importedName};`

          }
          return {codeLine, localName}
        }

        var generatePromiseImportForNode = node => {
          var moduleUID = path.scope.generateUidIdentifier("importedModule").name;

          var specifierInfo = node.specifiers.map(n => generateCodeForSpecifier(n, moduleUID))
          var specifierLocalNames = specifierInfo.map(n => n.localName)

          var specifierCode = specifierInfo.map(n => n.codeLine).join("\n")
          var specifierBlock = template.ast(`${specifierCode}`)
          if (specifierBlock) {
            var specifierNodes = Array.isArray(specifierBlock) ? specifierBlock : [specifierBlock]
            specifierNodes.forEach(node => {
              node.ignoreAll = true
            })
          }

          var importURI
          try {
            const url = new URL(node.source.value)
            importURI = url
          } catch(e) {
            importURI = "https://jspm.dev/" + node.source.value
            // TODO: need decoration in code to show this auto-replacement
            // console.log("Replaced import URI to", importURI)
          }

          var promise = template(`
            (async () => {
              try {
                var ${moduleUID} = await import("${importURI}")
                %%specifierBlock%%
                return {${specifierLocalNames.join(", ")}}
              } catch(e) {
                e.inSnippetLocation = ${node.end}
                e.codeSnippetID = "${codeSnippetID}"
                onError(e)
              }
            })()
          `)({specifierBlock})
          promise.ignoreAll = true
          promise.expression.ignoreAll = true
          return {promise, specifierLocalNames}
        }

        var importNodes = [path.node]
        var siblings = path.getAllNextSiblings()
        var breakingPoint
        for(var i = 0; i<siblings.length; i++) {
          var candidateNode = siblings[i].node
          if (candidateNode.type == "ImportDeclaration") {
            importNodes.push(candidateNode)
          } else {
            breakingPoint = i
            break
          }
        }

        var promisesInfo = importNodes.map(n => generatePromiseImportForNode(n))
        var allPromises = promisesInfo.map(p => p.promise.expression)
        var allSpecifiers = promisesInfo.map(p => p.specifierLocalNames).flat()

        var namespacePopulator = template(`
          var {${allSpecifiers.join(", ")}} = Object.assign({}, ...(await Promise.all(%%promiseList%%)))
        `, {allowAwaitOutsideFunction: true})({
          promiseList: babelType.arrayExpression(allPromises),
        })
        namespacePopulator.ignoreAll = true
        var newFlow = template(`
          (async () => {
            %%namespacePopulator%%
            %%code%%
          })()
        `)({
          namespacePopulator,
          code: siblings.slice(breakingPoint).map(p => p.node),
        })
        newFlow.ignoreNode = true
        newFlow.expression.ignoreNode = true
        newFlow.expression.callee.ignoreNode = true

        path.replaceWith(newFlow)
        siblings.forEach(p => p.remove())
      }
    },
    "ReturnStatement": {
      enter(path) {
        if (path.node.ignoreAll) {path.skip(); return}
        else if (path.node.ignoreNode) {return}
      },
      exit(path) {
        if (path.node.ignoreAll) {path.skip(); return}
        else if (path.node.ignoreNode) {return}

        // Only if "return <something>"
        if (!path.node.argument) {
          return
        }
        var retvalUID = babelType.toIdentifier("_sfExpTemp977")//path.scope.generateUidIdentifier("retval").name;
        var displayHelper = template(`
          {
            const ${retvalUID} = %%returnExpression%%;
            inspectorWidget({value: ${retvalUID}})
            return ${retvalUID};
          }
        `)
        var newNode = displayHelper({returnExpression: path.node.argument})
        var body = newNode.body
        body[0].ignoreAll = true; body[2].ignoreAll = true;
        body[1].ignoreAll = false; body[1].expression.end = path.node.end
        path.replaceWith(newNode)
      }
    },
    "VariableDeclaration": {
      enter(path) {
        // console.log("MainTrans: variable declr", path.node, generate(path.node))

        if (path.node.ignoreAll) {path.skip(); return}
        else if (path.node.ignoreNode) {return}

        for (var node of path.node.declarations) {
          var idsCode = generate(node.id).code

          var newNode = template.ast(`inspectorWidget({value: ${idsCode}})`)
          // Don't ignore this node -- it needs further transformation by CallExpression to add the location to the widget call.
          newNode.expression.end = path.node.end
          // This variable declaration might be in a for loop, which means path.listKey=undefined, path.key="init", and insertAfter won't work. TODO: when encounter for loop, insert into the body of the parentPath
          if (path.listKey == "body") {
            path.insertAfter(newNode)
          }
        }
      }
    },
    "CallExpression": {
      enter(path) {
        // console.log("MainTrans call", path, generate(path.node))
        if (path.node.ignoreAll) {path.skip(); return}
        else if (path.node.ignoreNode) {return}

        const calledFunctionName = path.node?.callee?.name
        if (calledFunctionName != undefined && calledFunctionName in widgetClassList) {
          // console.log("MainTrans In list")
          // console.log(storedWidgetCallCode[calledFunctionName])
          const widgetInstance = getWidgetInstance(path.node.end, calledFunctionName, codeSnippetID);
          if (widgetInstance.widgetClass.postTransform) {
            widgetInstance.widgetClass.postTransform({
              render: widgetInstance.sendRenderMessage,
              state: widgetInstance.state
            })
          }
          const shouldInsertLiterally = widgetInstance.widgetClass.shouldInsertLiterally

          if (!shouldInsertLiterally) {
            // In mainWrapperTransformPlugin transform, widget fcuntions
            // with correct name will be generated, will take extra location arg
            if (path.node.end == undefined) {
              console.warn("undefined path.node.end", {path, code: generate(path.parentPath.parentPath.node)})
            }
            const location = path.node.end
            var helper = template(`
              ${calledFunctionName}(%%widgetArgs%%, ${location}, "${codeSnippetID}")
            `)

            var newNode = helper({
              widgetArgs: path.node.arguments[0] || babelType.identifier("undefined")
            })

            // console.log("MainTrans, call, adding node", generate(newNode))
            // console.log({widgetClassList, node: path.node})
            path.parentPath.node.ignoreAll = true
            path.replaceWith(newNode)
            path.skip()

          } else {
            var instanceUID = path.scope.generateUidIdentifier("widgetInstance").name;
            var callCodeFuncUID = path.scope.generateUidIdentifier("callCodeFunc").name;

            const location = path.node.end

            // TODO: evalWidget can't add variables to scope, since it's declarations are nested twice
            var newCallExpression = template(`
              (() => {
                var ${instanceUID} = getWidgetInstance(${location}, "${calledFunctionName}", "${codeSnippetID}");
                var ${callCodeFuncUID} = %%callCode%%
                ${callCodeFuncUID}({
                  data: %%args%%,
                  render: ${instanceUID}.sendRenderMessage,
                  state: ${instanceUID}.state
                })
              })();
            `)
            var newCallNode = newCallExpression({
              callCode: widgetInstance.widgetClass.call.toString(),
              args: path.node.arguments[0] || babelType.identifier("undefined")
            })
            // newCallNode.ignoreAll = true
            // console.log("MainTrans, call, setting ignore on", generate(path.parentPath.node))
            path.parentPath.node.ignoreAll = true
            path.replaceWith(newCallNode)
            path.skip()
          }
        }
      }
    },
    "ExpressionStatement": {
      enter(path) {
        if (path.node.ignoreAll) {path.skip(); return}
        else if (path.node.ignoreNode) {return}
      },
      exit(path) {
        if (path.node.ignoreAll) {path.skip(); return}
        else if (path.node.ignoreNode) {return}
        const startTime = Date.now()
        // console.log("Expression, profiling")

        // console.log("Expression,name filtering step" + (Date.now()-startTime))

        // console.log("MainTrans: Parsing expression statement", path.node, generate(path.node).code)
        var expressionUID = babelType.toIdentifier("_sfExpTemp977")//path.scope.generateUid("value")
        // console.log(path.scope)
        // console.log("Expression, generated UIDs, " + (Date.now()-startTime))
        var newExpressionStatement = template(`
          {
            const ${expressionUID} = %%expressionHere%%
            inspectorWidget({value: ${expressionUID}})
          }
        `)
        // console.log("Expression, made template, " + (Date.now()-startTime))
        var newNode = newExpressionStatement({expressionHere: path.node.expression})
        var body = newNode.body
        // console.log("Expression, evaluated template, " + (Date.now()-startTime))
        body[0].ignoreNode = true; //still need expressionHere to be parsed
        body[1].ignoreAll = false; body[1].expression.end = path.node.end
        // console.log("Expression, ran code before replacing, " + (Date.now()-startTime))
        path.replaceWith(newNode)
        // console.log("Finished replacing with", newNode, generate(newNode).code)
      }
    },
    "ArrowFunctionExpression|FunctionExpression|TryStatement": {
      // TODO: this is so that we can try and skip the render func of registerWidget, which should not be modified. However, the ideal situatio would be to walk up from a node to the root before doing anything and check if .ignoreAll is set on any of the intermediate nodes
      enter(path) {
        // console.log("Function Expression", path.node)
        if (path.node.ignoreAll) {path.skip(); return}
        else if (path.node.ignoreNode) {return}
      }
    },
  }
  return (babel => ({visitor}))
}

// This needs to run as its own plugin because it requires the original AST paths from the handler call's node to the root of the AST
var extractHandlersTransformPlugin = () => {
  var visitor = {
    "CallExpression": {
      enter(path) {
        if (path.node.ignoreAll) {path.skip(); return}
        else if (path.node.ignoreNode) {return}

        const calledFunctionName = path.node?.callee?.name

        if (calledFunctionName == "useHandler") {

          var getAstLocation = path => {
            var keyList = []
            var currentPath = path
            while(currentPath) {
              keyList.unshift(currentPath.key)
              currentPath.listKey && keyList.unshift(currentPath.listKey)
              currentPath = currentPath.parentPath
            }
            return keyList
          }

          // Should we have state shenanigans here? Anyways, here it is.
          const scopeLocatorID = Math.random().toString()
          if (!workerState.scopeLocators) {
            workerState.scopeLocators = {}
          }
          // Reminder: specifier refers to location in AST and is string
          workerState.scopeLocators[scopeLocatorID] = specifier => {
            const specifierPath = path.scope.getBinding(specifier).path
            const location = getAstLocation(specifierPath)
            return location
          }

          // TODO: how will having this eval in code affect performance?

          var newCallNode = template(`
            useHandler(
              %%handlerFn%%,
              %%specifierArg%%,
              (function(codeString) {return eval(codeString)}),
             ${scopeLocatorID})
          `)({
            handlerFn: path.node.arguments[0],
            specifierArg: path.node.arguments[1],
          })
          newCallNode.expression.arguments[2].ignoreAll = true

          // console.log("handler node", path.node, evalArea.de)
          // console.log("WrapTrans, inserting evalArea", path.generate(evalArea))

          path.replaceWith(newCallNode)
          path.node.ignoreNode = true
          path.node.ignoreAll = false // don't come here again
        }

      }
    }
  }
  return (babel => ({visitor}))
}

var mainWrapperTransformPlugin = ({widgetClassList, registerWidget}) => {

  var visitor = {
    "Program": {
      enter(path) {
        //console.log("Code is", generate(path.node))
        var node = template.ast("onFinished()")
        // console.log("WrapTrans, prog, setting ignore on", generate(node))
        node.ignoreAll = true
        path.pushContainer('body', node);

        Object.keys(widgetClassList).forEach(widgetName => {
          var instanceUID = path.scope.generateUidIdentifier("widgetInstance").name;
          var funcNode = template.ast(`
            var ${widgetName} = (widgetArgs, location, codeSnippetID) => {
              var ${instanceUID} = getWidgetInstance(location, "${widgetName}", codeSnippetID);
              ${instanceUID}.widgetClass.call({
                data: widgetArgs,
                render: ${instanceUID}.sendRenderMessage,
                state: ${instanceUID}.state
              })
            }
          `)
          // console.log("WrapTrans, prog, setting ignore on", generate(funcNode))
          funcNode.ignoreAll = true
          path.unshiftContainer("body", funcNode)
          // return funcTemplate
        })

      },
      exit(path) {
        // console.log("WrapTrans: Exiting path", path.node, generate(path.node))
        var runnerUID = path.scope.generateUidIdentifier("runner").name;
        var programAsFunction = template(`
          var ${runnerUID} = ({onFinished, onError, getWidgetInstance, useHandler}) => {
            try {
              %%code%%
            } catch(e) {
              onError(e)
            }
          }
          return ${runnerUID}
        `)
        var node = path.node
        var newBody = programAsFunction({code: path.node.body})
        var newProgram = babelType.program(newBody, node.directives, node.sourceType, node.interpreter)
        // This ID is now added in base transform
        // var comments = {
        //     type: "BlockComment",
        //     value: "@ sourceURL=runnerVM"
        // };
        // newProgram.trailingComments = [comments]
        //Add the comment to make the runner inspectable in Chrome, FF debugger
        path.replaceWith(newProgram)
        path.skip()
      }
    },
    // TODO: maybe: Extract and call registerWidget, useHandler as if they were in a a seperate config file.
    "CallExpression": {
      enter(path) {
        if (path.node.ignoreAll) {path.skip(); return}
        else if (path.node.ignoreNode) {return}

        //console.log("WrapTrans, call",generate(path.node), generate(path.parentPath.parentPath.node))

        const calledFunctionName = path.node?.callee?.name
        if (calledFunctionName == "registerWidget") {
          // No change -- user has to supply widget name
        }
      }
    }
  }

  return (babel => ({visitor}))
}

// Debug function
var printSourceMap = map => {
  var mapper = new SourceMapConsumer(map)
  var arr = []
  mapper.eachMapping(m => arr.push(
    `${m.source} ${m.originalLine} ${m.originalColumn} | ${m.generatedLine} ${m.generatedColumn}`
  ))
  console.log(arr.join("\n"))
}

var getTransformedCode = ({codeString, pluginSets, onComment}) => {

  const lineColumnFinder = LineColumnFinder(codeString + " ") //add a space because babel can output error locations at technically non-existant location
  var originalPositionToOriginalIndex = position => {
    // Convert from [lines that start at 1, columns that start at 0] to [..., columns that start at 1]. Because this library uses that as origin.
    var charIndex = lineColumnFinder.toIndex(position.line, position.column+1)
    return charIndex
  }
  var lineLengths = codeString.split("\n").map(s => s.length)
  lineLengths = [null, ...lineLengths] //1-index

  // can't use our plugins at same time as transform-react-jsx, since our plugins use path.skip()

  // See https://babeljs.io/docs/en/options#ast for transform chaining

  var originalAst = parser.parse(codeString, {sourceType: "module", plugins: ["jsx"]})

  const transformStartTime = Date.now()
  // Add a react transform at the end for now
  pluginSets.push([/*availablePlugins["syntax-jsx"],*/ availablePlugins["transform-react-jsx"], availablePlugins["transform-react-display-name"]])

  var currentSourceMap = undefined
  var currentAst = originalAst
  var currentCode
  pluginSets.forEach((pluginList, idx) => {
    const makeCode = idx == pluginSets.length-1
    var transformed = transformFromAst(currentAst, null, {
      sourceMaps: true,
      ast: true,
      code: makeCode,
      sourceFileName: "runnerFile",
      plugins: [availablePlugins["syntax-jsx"], ...pluginList]
    })
    // transformed.ast.comments.forEach(comment => {})
    currentSourceMap = mergeSourceMap(currentSourceMap, transformed.map)
    currentCode = transformed.code
    currentAst = transformed.ast
  })

  // console.log(`Transforming took ${Date.now()-transformStartTime}ms`)

  // const debugMaintransformStart = Date.now()
  // // Order here is important. React preset adds code at top of file that we don't want transformed.
  // var transformed1 = transformFromAst(originalAst, null, {
  //   sourceMaps: true,
  //   plugins: [  availablePlugins["syntax-jsx"], ...plugins],
  //   sourceFileName: "runnerFile",
  //   ast: true, // Needed for comments
  //   code: false,
  // })
  // console.log(`Main Transform took ${Date.now()-debugMaintransformStart}ms`)
  // transformed1.ast.comments.forEach(comment => {
  //   // node.comments seems to get all comments, included nested ones. Position number is in original, not in transformed.
  //   onComment(comment.value, {start: comment.start, end: comment.end})
  // })
  // const debugJSXStart = Date.now()
  // var transformed2 = transformFromAst(transformed1.ast, null, {
  //   presets: ["react"],
  //   generatorOpts: {retainLines: true},
  //   sourceMaps: "both",
  // })
  // console.log(`JSX Transform took ${Date.now()-debugJSXStart}ms`)
  //
  // // This merging works better than default babel merging. I think default babel merging assumes something untrue
  // var mergedMap = mergeSourceMap(transformed1.map, transformed2.map)
  const sourceMapper= new SourceMapConsumer(currentSourceMap)

  var generatedPositionToOriginalPosition = position => {
    // Function(...) adds two lines to file/code, at least in chrome.

    var positionUpdated = {line: position.line, column: position.column}

    var originalPosition = sourceMapper.originalPositionFor(positionUpdated)
    return originalPosition
  }

  var code = currentCode
  const mapper = {generatedPositionToOriginalPosition, originalPositionToOriginalIndex, lineLengths}
  var output = {code, originalAst, mapper}
  return output
}

var registerWidget = (widgetClassObject, widgetClassID) => {
  if (widgetClassID == undefined) {
    throw "Widget Class ID is undefined"
  }
  const {render} = widgetClassObject
  workerState.widgetClassList[widgetClassID] = widgetClassObject

  var registerArgs = {widgetClassID}

  if (typeof render == "string") {
    registerArgs.displayComponentName = render
  } else if (render instanceof Function) {
    var serializedDisplayFunction = `React => {return (${render.toString()})}`
    registerArgs.display = serializedDisplayFunction
  } else {
    throw new Error("registerWidget must be passed an object like {render: <function>, call: <function>}")
  }
  workerState.postFrameMessage({registerWidget: registerArgs})
}

var checkAddHandlers = ({codeString, codeVersionID}) => {
  const startTime = Date.now()

  const currentAst = workerState.currentAst
  const updatedAst = parser.parse(codeString, {sourceType: "module", plugins: ["jsx"]})

  var prefilter = (path, key) => {
    const ignoreList = ["comments", "start", "end", "loc", "extra", "range"]
    return ignoreList.includes(key)
  }

  var differences = DeepDiff.diff(currentAst, updatedAst, prefilter)

  if (!differences) {
    // console.log("ast: ast didn't change")
    return {success: true}
  }

  // Check if the diff location is a child of the handler location.
  var pathIsChild = (diffPath, handlerPath) => {
    for (var i=0; i<handlerPath.length; i++) {
      if (handlerPath[i] != diffPath[i]) {
        return false
      }
    }
    return true
  }
  // Get the handler key for a given diff. If none match, return undefined
  var handlerPathForDiff = (diffPath, handlerPaths) => {
    for (var i=0; i<handlerPaths.length; i++) {
      if (pathIsChild(diffPath, handlerPaths[i])) {
        return handlerPaths[i]
      }
    }
    return undefined
  }

  // Keys are astPath.join(","), .astPath is the actual array
  const handlerPaths = Object.keys(workerState.changeHandlers).map(k => workerState.changeHandlers[k].astPath)
  var performers = {}
  for (let diff of differences) {
    const handlerPath = handlerPathForDiff(diff.path, handlerPaths)
    // console.log(diff.path)
    // console.log(handlerPath)
    if (performers[handlerPath]) {
      // Change already covered
      continue
    } else if (handlerPath == undefined) {
      // Diff not covered. break
      // console.log(`Processing handlers took ${Date.now()-startTime}ms. Diff not covered`)
      // console.log("ast: unhandled bound changes", diff.path, {diff, handlerPaths})
      return {success: false}
    }

    // start and end will be the same for different instances of a handler for the same function
    var firstHandler = workerState.changeHandlers[handlerPath].list[0]
    var updatedNode = updatedAst
    handlerPath.forEach(k => {updatedNode = updatedNode[k]})
    const {start, end} = updatedNode//.init

    const specifierCorrespondingCode = codeString.slice(start, end)

    var codeSnippetID = "RunnerVMSub-" + handlerPath.join("")
    const snippetOffset = start
    // Reset state for this specifier
    workerState.activeSnippets[codeSnippetID] = {}
    // Set this now, since getWidgetInstance (which is called immediately for postTransform) needs this info.
    workerState.activeSnippets[codeSnippetID] = {codeVersionID, snippetOffset}
//
    // Transform code that's to be swapped in
    const widgetClassList = workerState.widgetClassList
    var pluginSets = [[baseTransformPlugin({widgetClassList, getWidgetInstance, codeSnippetID, options: {returnFirstExpression: true}})]]
    const {code, mapper} = getTransformedCode({codeString: specifierCorrespondingCode, pluginSets, onComment: ()=>{}})
    mapper.topLineOffset = 0 //eval does not add any extra lines
    // Add mapper, which is mainly used by handleRunError
    workerState.activeSnippets[codeSnippetID] = {
      ...workerState.activeSnippets[codeSnippetID],
      mapper, codeVersionID
    }

    const performer = () => {
      var allHandlersForPath = [...workerState.changeHandlers[handlerPath].list]
      // Save a copy, since this list might change as the handlers run
      allHandlersForPath.forEach(handler => {
        // console.log("Evaluating code", code)
        const {handlerFn, evalArea} = handler
        // TODO: need more robust eval. Eval seems to only accept statement / expression? So need to transform code to fit that.
        // console.log("Transformed snipped code: \n", code)
        const newObject = evalArea(`${code}`)
        handlerFn(newObject)
      });
    }
    performers[handlerPath] = performer
  }

  // console.log("ast: calling all handlers")
  // Update the latest AST of the worker state, since we have processed the changes. Do this first in case code errors
  workerState.currentAst = updatedAst
  // console.log(`Processing handlers took ${Date.now()-startTime}ms`)

  //TODO: add try catch
  Object.values(performers).forEach(performer => performer())
  return {success: true}
}

// specifiers is a list of names referring to parts of the code
// fn will be called when those parts of the code change
// evalArea and astPath will be added as argument by mainWrapperTransformPlugin
var useHandler = (handlerFn, astSpecifier, evalArea, scopeLocatorID) => {
  try {
    var astPath = workerState.scopeLocators[scopeLocatorID](astSpecifier)
  } catch(e) {
    console.error("AST specifier scope lookup threw", e)
    throw new Error(`AST Specifier \`${astSpecifier}\` could not be resolved to an AST location`)
  }

  if (!workerState.changeHandlers[astPath]) {
    workerState.changeHandlers[astPath] = {astPath, list: []}
  }
  const obj = {handlerFn, evalArea}
  workerState.changeHandlers[astPath].list.push(obj)

  var removeHandler = () => {
    const idx = workerState.changeHandlers[astPath].list.indexOf(obj)
    if (idx == -1) {
      console.error("Trying to remove handler that doesn't exist in list, why?")
    }
    workerState.changeHandlers[astPath].list.splice(idx, 1)
  }
  return removeHandler
}

var getWidgetInstance = (inSnippetLocation, widgetClassID, codeSnippetID, codeVersionIDIn) => {

  // console.log("Trying to get widget instance", {inSnippetLocation, codeSnippetID, codeVersionID})
  var location
  var codeVersionID
  var snippetData = workerState.activeSnippets[codeSnippetID]

  if (snippetData) {
    codeVersionID = snippetData.codeVersionID
    const offset = snippetData.snippetOffset
    // Location in the program, not just location in re-evaled subset
    location = inSnippetLocation + offset
  } else {
    // Special case for parse error (needs to make widget, but its code hasn't actually run)
    codeVersionID = codeVersionIDIn
    location = inSnippetLocation
  }

  const widgetInstanceID = location + codeVersionID
  const widgetClass = workerState.widgetClassList[widgetClassID]
  if (!(widgetInstanceID in workerState.widgetData)) {
    workerState.widgetData[widgetInstanceID] = {class: widgetClass, state: {}}
  }

  var sendRenderMessage = (data, extra) => {
    const {isBlock} = widgetClass
    workerState.postFrameMessage({callWidget: {data, widgetClassID, widgetInstanceID, location, codeVersionID, codeSnippetID, isBlock, ...extra}})
  }
  return {sendRenderMessage, state: workerState.widgetData[widgetInstanceID].state, widgetClass}
}

// Convert object to a short string describing it
var shortRepresentation = obj => {
  if (!(obj instanceof Object || typeof obj == "object") || obj == null) {
    // undefined, null go here
    if (typeof obj == "string") {
      return `"${obj}"`
    }
    return String(obj)
  } else {
    var out = obj?.constructor?.name
    return out
  }
}

// Convert object to dict with shallow-representation of obj
var longRepresentation = obj => {
  var widgetOptions = {}
  // console.log(obj)

  if (obj == null || obj == undefined) {
    // Primitive
    widgetOptions = {type: "primitive", value: shortRepresentation(obj)}
  }
  else if (!(obj instanceof Object || typeof obj == "object")) {
    // Primitive
    widgetOptions = {type: "primitive", value: shortRepresentation(obj)}
  } else if (obj instanceof Error) {
    // Error
    var message = obj.message.split("\n")[0]
    widgetOptions = {type: "error", message}
  } else if (obj instanceof Function) {
    // Function
    widgetOptions = {type: "function", value: (obj.name || "anonymous")+"(...)"}
  } else if (obj instanceof Element || obj instanceof HTMLDocument || obj instanceof Event) {
    // DOM Object
    // For some reason, on Chrome at least, only for...in shows DOM obj props.
    // Must be something to do with the bridge between DOM and js
    var propNames = []
    for (var prop in obj) {
      propNames.push(prop)
    }
    var value = {}
    propNames.forEach(propName => {
      value[propName] = shortRepresentation(obj[propName])
    })
    widgetOptions = {type: "object", value}
  } else {
    // Object
    if (obj.toString && (obj.toString != Object.prototype.toString)) {
      widgetOptions.toStringOutput = obj.toString()
    }
    var propNames = Object.keys(Object.getOwnPropertyDescriptors(obj))
    var value = {}
    propNames.forEach(propName => {
      value[propName] = shortRepresentation(obj[propName])
    })
    value["_proto_"] = shortRepresentation(Object.getPrototypeOf(obj))
    widgetOptions = {type: "object", value}
  }

  widgetOptions.constructorName = obj?.constructor?.name || "Proto-less Object"
  return widgetOptions
}

// Register inspectorWidget, evalWidget
var registerPredefinedWidgets = () => {
  // WIDGET OBJECT SUMMARY: {render: ..., update: ..., call: ...}
  // "call" is either (*literally* inserted into the code) or (has a call to it inserted) during transformation
  // "update" function is stored and called when the UI Component tells it to run
  // "render" is either defined by the user, serialized, and sent to the main iframe. Or it is defined in the main iframe.
  // options: isBlock, insertLiterally
  registerWidget({
    render: ({data, update}) => {
      const inspectorWidget = () => {}
      var DeserializedFn = Function("React", "inspectorWidget", 'return ('+data+')')(React, inspectorWidget)
      const component = React.createElement(DeserializedFn, {}, null)
      return component
    },
    update: ({data, render, state}) => {

    },
    call: ({data, render, state}) => {
      const reactComponentString = data.toString()
      render(reactComponentString)
    },
    isBlock: true,
  }, "serializedReactComponentWidget")

  // Register inspector widget
  var inspectorWidgetClass = {
    render: "InspectorWidget",
    update: ({data, render, state}) => {
      if (data?.resetPath) {
        state.path = []
        inspectorWidgetClass.call({data: undefined, render, state})
      } else if (data?.pathBack) {
        state.path.pop()
        inspectorWidgetClass.call({data: undefined, render, state})
      } else if (data?.pathAdd) {
        // If user clicks on sub-object, return more data on that object
        if (data.pathAdd == "_proto_") {data.pathAdd = "__proto__"}
        state.path.push(data.pathAdd)
        inspectorWidgetClass.call({data: undefined, render, state})
      } else if (data?.expand) {
        // Send more data on errors and functions if user clicks
      }
    },
    call: ({data, render, state}) => {
      if (data?.hasOwnProperty("value")) {
        // can't use if (data.value), since it might be "undefined"
        state.obj = data.value
        state.path = state.path || []
      } else if (data != undefined) {
        throw new Error("Invalid call. Example call: inspectorWidget({value: myObj})")
      }
      var obj = state.obj
      if (state.path.length > 0) {
        try {
          state.path.forEach(p => {
            obj = obj[p]
          })
        } catch(e) {
          obj = state.obj
          console.log("Inspected object changed, path no longer exists")
          state.path = []
        }
      }
      var widgetOptions = longRepresentation(obj)
      render({remoteObj: widgetOptions, path: state.path})
    },
    isBlock: false,
  }
  registerWidget(inspectorWidgetClass, "inspectorWidget")

  var evalWidgetClass = {
    render: "EvalWidget",
    postTransform: ({render, state}) => {
      // To prevent disappearing and re-appearing and code jumping around
      render({inspectorWidget: {}})
    },
    update: ({data, render, state}) => {
      state.pendingFuncString = data.codeString
      var inspectorRenderArgs
      var subRender = args => {inspectorRenderArgs = args}
      inspectorWidgetClass.update({data: data?.inspectorWidget, render: subRender, state: state.inspectorWidget})
      inspectorRenderArgs && render({inspectorWidget: inspectorRenderArgs})
      // console.log("Updaate: inspectorWidget", inspectorRenderArgs, state.inspectorWidget)
    },
    call: ({data, render, state}) => {
      if(state.pendingFuncString) {
        var res
        try {
          res = eval(state.pendingFuncString)
        } catch(e) {
          res = e
        }
        var inspectorRenderArgs
        var subRender = args => {inspectorRenderArgs = args}
        // Confusing because this code is literally inserted, so have to use ??, since it will be in scope where this is inserted
        workerState.widgetClassList["inspectorWidget"].call({data: {value: res}, render: subRender, state: state.inspectorWidget || {}})
        render({inspectorWidget: inspectorRenderArgs})
        // console.log("Call: inspectorWidget", inspectorRenderArgs, state.inspectorWidget, res)
      } else {
        state.inspectorWidget = {}
        render({inspectorWidget: {}})
      }
    },
    isBlock: true,
    shouldInsertLiterally: true,
  }
  registerWidget(evalWidgetClass, "evalWidget")
}

var checkParseError = ({codeString}) => {
  var codeParses
  var parseError
  try {
   var ast = parser.parse(codeString, {sourceType: "module", plugins: ["jsx"]})
   codeParses = true
  } catch(e) {
   codeParses = false
   parseError = e
   parseError.code = codeString
  }
  return ({codeParses, parseError})
}

onmessage = e => {
  const data = e.data
  const port = e.ports[0]
  if (!(e.data.from == "interpreterController")) {
    return // who can send messages to webWorker? for one, metamask can
  }
  // Initializes state, including setting interpreterID
  if (data.initialize) {
    initialize(data.initialize)
  }

  if (data.interpreterID != workerState.interpreterID) {
    console.warn("Worker received message intended for other (old?) interpreter; ignoring", data)
    return
  }
  //console.log("Worker message", e.data)


  // Synchronous response. Uses passed port.
  if (data.isInitialized) {
    var output = {initialized: !!workerState.initialized}
    port.postMessage(output)
  } else if (data.startedRun) {
    // is running / has received code
    var output = {startedRun: !!workerState.startedRun}
    port.postMessage(output)
  } else if (data.checkParseError) {
    var output = checkParseError(data.checkParseError)
    port.postMessage({codeParses: output.codeParses})
    if (output.parseError) {
      handleParseError({e: output.parseError, ...data.checkParseError})
    } else {
      workerState.postFrameMessage({parseSuccess: true})
    }
  } else if (data.checkAddHandlers) {
    // var output = {success: false}
    var output = checkAddHandlers(data.checkAddHandlers)
    port.postMessage(output)
  } else if (data.reload) {
    var output = {received: true}
    port && port.postMessage(output) // will this get sent?
    // TODO: de-jankify
    window.location.href = window.location.origin + "/runner.html"
  }

  // Asynchronous.
  if (data.reload) {
    // TODO: de-jankify
    window.location.href = window.location.origin + "/runner.html"
    return
  }

  if (data.runCode) {
    runCode(data.runCode)
  }

  if (data.sendMessageToWidget) {
    sendMessageToWidget(data.sendMessageToWidget)
  }

}

// TODO: clean up the messaging between frames -- its messy
var sendMessageToWidget = ({data, widgetClassID, widgetInstanceID, codeVersionID, codeSnippetID, location}) => {

  if (!workerState.widgetData[widgetInstanceID]) {
    console.error("Error: widget not found!", widgetInstanceID, message)
    return
  }

  var sendRenderMessage = data => {
    workerState.postFrameMessage({callWidget: {data, widgetClassID, widgetInstanceID, codeVersionID, codeSnippetID, location}})
  }
  var widgetInstanceState = workerState.widgetData[widgetInstanceID].state
  widgetInstanceState.test = true
  workerState.widgetData[widgetInstanceID].class.update?.({
    data, render: sendRenderMessage, state:widgetInstanceState
  })
}

var handleParseError = ({e, codeVersionID}) => {
  console.error("Error while parsing", e)

  const lineColumnFinder = LineColumnFinder(e.code + " ")
  var originalPositionToOriginalIndex = position => {
    var charIndex = lineColumnFinder.toIndex(position.line, position.column+1)
    return charIndex
  }
  var lineLengths = e.code.split("\n").map(s => s.length)
  lineLengths = [null, ...lineLengths] //1-index

  const mapper = {originalPositionToOriginalIndex, lineLengths}
  var line
  if (e.loc.column == 0 && e.loc.line != 1) {
    line = e.loc.line - 1 // If error is at col 0 of some line, it usually is assoc with line above
  } else {
    line = e.loc.line
  }
  var lineLength = mapper.lineLengths[line]
  var insertPosition = {line: line, column: lineLength}
  var insertLocation = mapper.originalPositionToOriginalIndex(insertPosition)
  // console.log(e.lineColumnFinder.lineLengths)

  // Use main snippet for now, need to fix since will lead to editor applying wrong change map for actual deco.
  const codeSnippetID = "ParseCheckingCode"
  var {sendRenderMessage, state, widgetClass} = getWidgetInstance(insertLocation, "inspectorWidget", codeSnippetID, codeVersionID);
  var render = m => sendRenderMessage(m, {syntaxError: true})
  widgetClass.call({data: {value: e}, render, state})
}

var runCode = ({codeString, codeVersionID}) => {
  if (workerState.startedRun) {
    console.warn("Code has already run! This is wrong")
  }
  var handleRunError = ({e, errorType}) => {
    console.error("Error while running", e)

    var codeSnippetID
    var insertLocation

    if (e.inSnippetLocation) {
      // We might set the error location in our transform, if it's something we catch
      codeSnippetID = e.codeSnippetID
      insertLocation = e.inSnippetLocation
    } else {
      var originalPosition
      var mapper
      try {
        var parsedError = ErrorStackParser.parse(e)
        // Probably Safari, can still guess error position
        var includesRunner = false
        parsedError.forEach(frame => {
          includesRunner = includesRunner || frame?.functionName == "_runner"
        })
        if (includesRunner && e.line != undefined && e.column != undefined) {
          // Only works for errors in main body :/
          mapper = workerState.activeSnippets["RunnerVMInitial"].mapper
          var generatedPosition = {line: e.line - mapper.topLineOffset + 1, column: e.column - 2}
          originalPosition= mapper.generatedPositionToOriginalPosition(generatedPosition)
          // for (var i=-6; i< 6; i++) {
          //   for (var j=-6; j<6; j++) {
          //     var pos = {line: generatedPosition.line +i, column: generatedPosition.column +j}
          //     console.warn(i,j, mapper.generatedPositionToOriginalPosition(pos))
          //   }
          // }
          // console.log("Custom safari error parser, error mapped to", originalPosition)
        }
        for (var frame of parsedError) {
          // Find first frame that occurs in a sourceURL we made
          var activeSnippetSourceURLs = Object.keys(workerState.activeSnippets)
          if (activeSnippetSourceURLs.includes(frame.fileName)) {
            console.log("for error found", frame)
            codeSnippetID = frame.fileName
            mapper = workerState.activeSnippets[codeSnippetID].mapper
            const {lineNumber, columnNumber} = frame
            // Subtract 1 from column number, since chrome uses 1-indexed columns and we use 0
            // Subtract something from line to compensate for what browser adds to Function(...)
            var generatedPosition = {line: frame.lineNumber - mapper.topLineOffset, column: frame.columnNumber - 1}
            originalPosition= mapper.generatedPositionToOriginalPosition(generatedPosition)
            console.log("error mapped to", originalPosition)
            break
          }
        }
      } catch(e) {
        console.log("Error parsing failed")
      }
      if (!originalPosition) {
        console.log("Couldn't find error position in code")
        insertLocation = 0
        var insertPosition = {line:0, column: 0}
        // return
      } else {
        console.log("original position", originalPosition)
        const line = originalPosition.line
        var lineLength = mapper.lineLengths[line]
        var insertPosition = {line, column: lineLength - 1}
        //var insertPosition = originalPosition
        insertLocation = mapper.originalPositionToOriginalIndex(insertPosition) + 1
      }
    }

    console.log("error position", insertPosition, "codeSnippetID", codeSnippetID)

    if (codeSnippetID == undefined || codeSnippetID == "undefined") {
      console.log("No code snippet ID found, using RunnerVMInitial")
      codeSnippetID = "RunnerVMInitial"
    }

    insertPosition += workerState.activeSnippets[codeSnippetID].snippetOffset

    var {sendRenderMessage, state, widgetClass} = getWidgetInstance(insertLocation, "inspectorWidget", codeSnippetID);
    var render = m => sendRenderMessage(m, {errorType})
    widgetClass.call({data: {value: e}, render, state})
  }

  var onError = e => {
    console.warn("error", {e})
    handleRunError({e, errorType: "run"})
    // workerState.postFrameMessage({finished: true})
  }

  // Style comments with markdown (just # header for now)
  var onComment = (content, location) => {
    // Maybe parse markdown here
    var args = {location, widgetOptions: {type: "comment", content}}
    workerState.postFrameMessage({markdownWidget: args})
  }

  window.addEventListener("error", event => {
    onError(event.error)
  })

  // Promise rejection errors. TODO: make it say "promise error" instead of "run error"
  window.onunhandledrejection = event => {
    event.promise.catch(e => {
      handleRunError({e, errorType: "promise"})
    })
  }
  // TODO: add try catch try transform below, so only catching user errors

  // Transform code, and set the requisite mappers and IDs.
  const codeSnippetID = "RunnerVMInitial"
  const snippetOffset = 0
  workerState.activeSnippets[codeSnippetID] = {codeVersionID, snippetOffset}
  const widgetClassList = workerState.widgetClassList
  var pluginSets = [[extractHandlersTransformPlugin()],[baseTransformPlugin({widgetClassList, getWidgetInstance, codeSnippetID}),         mainWrapperTransformPlugin({widgetClassList})]
  ]
  var {code, originalAst, mapper} = getTransformedCode({codeString, pluginSets, onComment})
  mapper.topLineOffset = 2 // Wrapping in Function(...) adds two lines
  workerState.activeSnippets[codeSnippetID] = {
    ...workerState.activeSnippets[codeSnippetID],
    mapper, codeVersionID
  }
  // console.log(`Transforming run code took ${Date.now()-transformStartTime}ms`)

  // Run the code
  // console.log(code)
  var runner = Function(code)()
  var onFinished = () => {
    // workerState.postFrameMessage({finished: true})
  }
  // console.log("Running Code ast")
  workerState.currentAst = originalAst
  workerState.startedRun = true
  runner({onFinished, onError, useHandler, registerWidget, getWidgetInstance})
}


var initialize = (args) => {
  if (workerState.initialized) {
    console.warn("Warning: worker is being re-initialized. Dom and other window state won't be reset")
  }
  // Reset all state
  workerState.initialized = true
  workerState.startedRun = false
  workerState.widgetData = {} //[instanceID]: {classObj, state}
  workerState.changeHandlers = {}
  workerState.widgetClassList = {} //key: name, val: classObj
  workerState.activeSnippets = {}
  const {interpreterID, parentOrigin} = args
  workerState.postFrameMessage = data => {
    data = {...data, interpreterID}
    window.parent.postMessage(data, parentOrigin)
  }
  workerState.interpreterID = interpreterID
  // console.log("Initializing worker", {interpreterID})
  registerPredefinedWidgets()
}
