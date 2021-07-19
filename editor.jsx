// # All Imports

import React, { useEffect } from "react";
import ReactDOM from "react-dom"
import ReactDOMServer from 'react-dom/server';
import "regenerator-runtime/runtime";
// import {transform as BabelTransform} from "@babel/standalone"
// import {parse as BabelParse} from "@babel/parser"

// UI Components
import {AiOutlineCloseCircle} from "react-icons/ai"

// Stuff for EditorCode
import {EditorState, StateField, StateEffect} from "@codemirror/state"
import {EditorView, keymap} from "@codemirror/view"
import {defaultTabBinding, indentMore, indentSelection} from "@codemirror/commands"
//import {javascript} from "./codeEditor/lang-jsx"
import {javascript} from "@codemirror/lang-javascript"

//import {indentWrap} from "./codeEditor/indentWrap"
import {css} from "@codemirror/lang-css"
import {xml} from "@codemirror/lang-xml"
//import {oneDark as oneLight} from "@codemirror/theme-one-dark"
//import {oneLight} from "./codeEditor/oneLight"

import {indentOnInput, getIndentation} from "@codemirror/language"
import {defaultKeymap} from "@codemirror/commands"
import {bracketMatching} from "@codemirror/matchbrackets"
import {searchKeymap, highlightSelectionMatches} from "@codemirror/search"
import {history, historyKeymap} from "@codemirror/history"
import {commentKeymap} from "@codemirror/comment"
import {lineNumbers} from "@codemirror/gutter"
import {autocompletion, completeAnyWord} from "@codemirror/autocomplete"

// For Style
import { HighlightStyle, tags } from '@codemirror/highlight';

// For my EditorCode extension
import {Extension, MapMode, Compartment, ChangeSet} from "@codemirror/state"
import {Decoration} from "@codemirror/view"
import {RangeSetBuilder, Range, RangeSet} from "@codemirror/rangeset"
import {ViewPlugin, DecorationSet, WidgetType, ViewUpdate} from "@codemirror/view"
import {renderToString} from "react-dom/server"
//import * as interpreterWorker from "./interpreterWorker"

// For YJS collaboration experiment
import * as Y from 'yjs'
import { yCollab } from './yCodemirrorNext'
import logoImage from "./logo.png"
import { WebrtcProvider } from 'y-webrtc'
import { IndexeddbPersistence } from 'y-indexeddb'

// STYLE dict

const STYLE = {
  fontFamilyBold: ["Open Sans Condensed", "sans-serif"],
  fontFamily: `"Open Sans", "sans-serif"`,
  fontSizeMedium: 18,
  //colorSecondary: "FDBA31"
  colorThird: "antiquewhite",
  colorGray: "#4d4d4d",
  colorSecondary: "black",
  marginMedium: 32,
  marginSmall: 18,
  marginXSmall: 8,
}

// # Indent Wrap Hack

const WHITESPACE_REGEX = /^\s+/

// from stackoverflow
function indentDeco(view) {
  // get every line of the visible ranges
  const lines = new Set()
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      let line = view.state.doc.lineAt(pos)
      lines.add(line)
      pos = line.to + 1
    }
  }

  // get the indentation of every line
  // and create an offset hack decoration if it has any
  const tabInSpaces = ' '.repeat(view.state.facet(EditorState.tabSize))
  const builder = new RangeSetBuilder()
  for (const line of lines) {
    // there is almost certainly a much better way to do this
    const WS = WHITESPACE_REGEX.exec(line.text)?.[0]
    const col = WS?.replaceAll('\t', tabInSpaces).length
    if (col) {
      builder.add(line.from, line.from, Decoration.line({
        attributes: { style: `padding-left: ${col}ch; text-indent: -${col}ch` }
      }))
    }
  }

  return builder.finish()
}

const indentHack = ViewPlugin.fromClass(
  class {
    decorations
    constructor(view) {
      this.decorations = indentDeco(view)
    }
    update(update) {
      if (update.docChanged || update.viewportChanged)
        this.decorations = indentDeco(update.view)
    }
  },
  { decorations: v => v.decorations }
)

// # One Light Theme

// Using https://github.com/atom/atom/tree/master/packages/one-light-syntax/ as reference for the colors
var hueMono1 = "hsl(230, 8%, 24%)"
var hueMono2 = "hsl(230, 6%, 44%);"
var hueMono3 = "hsl(230, 4%, 64%);"

var hue1 = "hsl(198, 99%, 37%);" // <-cyan
var hue2 = "hsl(221, 87%, 60%);" // <-blue
var hue3 = "hsl(301, 63%, 40%);" // <-purple
var hue4 = "hsl(119, 34%, 47%);" // <-green
var hue5 = "hsl(  5, 74%, 59%);" // <-red 1
var hue52 = "hsl(344, 84%, 43%);" // <-red 2
var hue6 = "hsl(35, 99%, 36%); "// <-orange 1
var hue62 = "hsl(35, 99%, 40%); "// <-orange 2

var darkBackground = "white"
var highlightBackground = "#2c313a"
var background = "white"
var selection = "#eee"
var cursor = "hsl(230, 100%, 66%)"

/// The editor theme styles for One Dark.
const oneLightTheme = EditorView.theme({
    "&": {
        color: hueMono1,
        backgroundColor: background,
        "& ::selection": { backgroundColor: selection },
        caretColor: cursor
    },
    "&.cm-focused .cm-cursor": { borderLeftColor: cursor },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: selection },
    ".cm-panels": { backgroundColor: darkBackground, color: hueMono1},
    ".cm-panels.cm-panels-top": { borderBottom: "2px solid black" },
    ".cm-panels.cm-panels-bottom": { borderTop: "2px solid black" },
    ".cm-searchMatch": {
        backgroundColor: "#72a1ff59",
        outline: "1px solid #457dff"
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: "#6199ff2f"
    },
    ".cm-activeLine": { backgroundColor: highlightBackground },
    ".cm-selectionMatch": { backgroundColor: "#aafe661a" },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
        backgroundColor: "#bad0f847",
        outline: "1px solid #515a6b"
    },
    ".cm-gutters": {
        backgroundColor: background,
        color: hueMono1,
        border: "none"
    },
    ".cm-lineNumbers .cm-gutterElement": { color: "inherit" },
    ".cm-foldPlaceholder": {
        backgroundColor: "transparent",
        border: "none",
        color: "#ddd"
    },
    ".cm-tooltip": {
      border: "none",
      borderRadius: "4px",
      overflow: "hidden",
      boxShadow: "0px 1px 5px rgba(0,0,0,0.16)",
      backgroundColor: "#F2F2F2",
      "&.cm-tooltip-autocomplete > ul": {
        fontFamily: "MonoLisa, Menlo, Monaco, 'Courier New', monospace",
        fontSize: 14,
        letterSpacing: "0.5px",
      },
      "&.cm-tooltip-autocomplete > ul > li": {
        lineHeight: "1.5em"
      },
      // border: "1px solid #181a1f",
      // backgroundColor: darkBackground
    },
    ".cm-completionMatchedText": {
      fontWeight: "bold",
      textDecoration: "unset",
    },
    ".cm-tooltip-autocomplete": {
      "& > ul": {
        fontFamily: STYLE.fontFamily,
      }
        // "& > ul > li[aria-selected]": {
        //     backgroundColor: highlightBackground,
        //     color: hueMono1
        // }
    }
}, { dark: false });

/// The highlighting style for code in the One Dark theme.
const oneLightHighlightStyle = HighlightStyle.define([
    { tag: tags.keyword,
        color: hue3 },
    { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName],
        color: hue5},
    { tag: [tags.function(tags.variableName), tags.labelName, tags.function(tags.propertyName)],
        color: hue2},
    { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)],
        color: hue6},
    { tag: [tags.definition(tags.name), tags.separator],
        color: hue5},
    { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace],
        color: hue62},
    { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)],
        color: hue1},
    { tag: [tags.meta, tags.comment],
        color: hueMono3},
    { tag: tags.strong,
        fontWeight: "bold" },
    { tag: tags.emphasis,
        fontStyle: "italic" },
    { tag: tags.link,
        color: hueMono3,
        textDecoration: "underline" },
    { tag: tags.heading,
        fontWeight: "bold",
        color: hueMono3},
    { tag: [tags.atom, tags.bool, tags.special(tags.variableName)],
        color: hue6},
    { tag: [tags.processingInstruction, tags.string, tags.inserted, tags.definition(tags.propertyName)],
        color: hue4},
    { tag: tags.invalid,
        color: "red"},
]);
/// Extension to enable the One Dark theme (both the editor theme and
/// the highlight style).
const oneLight = [oneLightTheme, oneLightHighlightStyle];

// # Main Code

const textStroke = (width, color) => {
  var style = {
    WebkitTextStrokeWidth: width,
    textStrokeWidth: width,
    WebkitTextStrokeColor: color,
    textStrokeColor: color,
  }
  return style
}

const userSelectNone = {
  userSelect: "none",
  WebkitUserSelect: "none",
}

var App = props => {

  var output = <>
    <div style={{display: "grid", gridTemplateRows: "minmax(0, 1fr)", height: "100%", fontFamily: STYLE.fontFamily, width: "100%", height: "100vh"}}>
      <Editor path="/"/>
    </div>
  </>

  return output
}

var Landing = props => {
  var content = <>
    landing
  </>

  return content
}

// Later, the editor itself might be user-settable and thus will have to run in an iframe
var Editor = props => {
  var workHash = props.workHash

  // TODO: uncomment
  var remoteSourceState = null
  // var remoteSourceState = useRemoteDecentralDirectory(workHash)

  const defaultSourceState = {
    "index.jsx": {text: "testing", scrollPos: 0}
  }

  var [sourceState, setSourceState] = React.useState(() => {
    var savedSource = JSON.parse(window.localStorage.getItem("savedSource")) || defaultSourceState
    return savedSource
  })

  // Not working for some reason, always set to 0
  React.useEffect(() => {
    window.localStorage.setItem("savedSource", JSON.stringify(sourceState))
  }, [sourceState])

  React.useEffect(() => {
    if (remoteSourceState) {
      setSourceState(remoteSourceState)
    }
  }, [remoteSourceState])

  // var editorType = "code"

  var editorComponent
  // Don't initialize EditorCode until have non-null sourceState, since it's a non-managed component.
  // if (editorType == "code" && sourceState) {
    editorComponent = <EditorCode {...{sourceState, setSourceState}} readOnly={props.readOnly}/>
  // }

  const viewerSize = 300
  var content = <>
    <div style={{width: "100%", boxShadow: "0px 0px 12px #e9e9e9", borderRadius: 10, position: "relative", overflow: "hidden", height: "100%"}}>
      {editorComponent}
    </div>
  </>

  return content
}

class ReactWidget extends WidgetType {
  constructor(componentInstance, options) {
    super()
    this.componentInstance = componentInstance
    this.options = options
    this.requiredContainer = this.options.isBlock ? "DIV" : "SPAN"
  }
  toDOM(view) {
    var container = document.createElement(this.requiredContainer)
    container.style.marginLeft = this.options?.indent ? this.options.indent + "ch" : "4px"
    try {
      ReactDOM.render(this.componentInstance, container)
    } catch(e) {
      console.error("Widget Rendering Error", this.componentInstance)
    }
    return container
  }
  updateDOM(oldDOM) {
    var container = oldDOM
    if (oldDOM.tagName != this.requiredContainer) {
      console.log("Replacing mismatched node container")
      ReactDOM.unmountComponentAtNode(oldDOM)
      container = document.createElement(this.requiredContainer)
      oldDOM.replaceWith(container)
    }

    container.style.marginLeft = this.options?.indent ? this.options.indent + "ch" : "4px"
    try {
      // Effectively renders the component with the new props, preserving state.
      ReactDOM.render(this.componentInstance, container)
    } catch(e) {
      console.error("Widget Rendering Error", this.componentInstance)
    }
    return true
  }
  eq(oldWidget) {
    return false
  }
}
var InspectorWidget = ({data: {remoteObj, path}, update}) => {
  var [popupShown, setPopupShown] = React.useState(false)
  var [mousedOver, setMousedOver] = React.useState(false)

  var onBackPressed = () => {
    if (path.length == 0) {
      setPopupShown(false)
      update({resetPath: true})
    } else {
      update({pathBack: true})
    }
  }
  var makePopup = contents => {
    var popup = <>
      <div style={{position: "relative", display: "inline", cursor: "default"}}>
        <div style={{position: "absolute", top: 0, left: 0, padding: 10, borderRadius: 10, boxShadow: "0px 0px 12px #e9e9e9", backgroundColor: "white", display: "grid", gridAutoFlow: "row", width: "max-content", maxHeight: "400px", overflow: "auto", zIndex: 1}}>
          <div style={{display: "flex", justifyContent: "space-between"}}>
            <div style={{textAlign: "left", cursor: "pointer"}} onClick={onBackPressed}>
              Back
            </div>
            <div style={{textAlign: "right", cursor: "pointer"}} onClick={() => {setPopupShown(false); update({resetPath: true})}}>
              Close
            </div>
          </div>
          <div style={{display: "grid", gridAutoFlow: "row", maxWidth: "700px"}}>
            {contents}
          </div>
        </div>
      </div>
    </>
    return popup
  }

  const type = remoteObj.type
  var inner
  if (type == "error") {
    var backgroundColor = "red"
    if (remoteObj.constructorName == "SyntaxError") {
      backgroundColor = "rgb(250, 230, 105)"
    }
    inner = <>
      <div style={{color: "white",padding: "2px", borderRadius: "3px", display: "inline", backgroundColor}}>
        {remoteObj.message}
      </div>
    </>
  } else if (type == "object") {

    var objectFieldsDisplay = []
    var objectFields = Object.entries(remoteObj.value)

    var idx = 0
    for (let [k,v] of objectFields) {
      var comma = idx == objectFields.length - 1 ? "" : ", "
      var field = <span key={idx}>
        <span style={{fontWeight: "bold"}}>{k + ":"}</span>
        <span style={{cursor: "pointer"}} onClick={() => update({pathAdd: k})}>{v + comma}</span>
      </span>
      objectFieldsDisplay.push(field)
      idx++
    }

    var buttonColor = mousedOver ? "slateblue" : "unset"
    var constructorNameButton = <>
      <span style={{textDecoration: "underline", cursor: "pointer", color: buttonColor}} onClick={() => setPopupShown(true)} onMouseEnter={() => setMousedOver(true)} onMouseLeave={() => setMousedOver(false)}>
        {remoteObj.constructorName}
      </span>
    </>

    var popup
    if (popupShown) {
      popup = makePopup(objectFieldsDisplay)
    }

    var truncatedObjectFieldsDisplay = objectFieldsDisplay.slice(0, 5)
    if (objectFieldsDisplay.length > 3) {
      truncatedObjectFieldsDisplay.push("...")
    }
    inner = <>
      {popup}
      {/* <span style={{display: "inline-grid", gridAutoFlow: "column", columnGap: "5px"}}> */}
      <span style={{}}>
        {constructorNameButton}
        <span style={{marginRight: "5px"}}></span>
        {/* <span>{"{"}{truncatedObjectFieldsDisplay}{"}"}</span> */}
      </span>
    </>
  } else if (typeof remoteObj.value == "string") {

    const string = remoteObj.value
    const truncationLength = 50
    var truncatedString
    var newlineLocation = string.indexOf("\n")
    var isLongString = string.length > truncationLength
    if (newlineLocation != -1 || isLongString) {
      var truncationLocation = truncationLength
      if (newlineLocation != -1) {
        truncationLocation = Math.min(truncationLength, newlineLocation)
      }
      truncatedString = string.slice(0, truncationLocation)
      var buttonColor = mousedOver ? "slateblue" : "unset"
      var stringButton = <>
        <span style={{cursor: "pointer", color: buttonColor}} onClick={() => setPopupShown(true)} onMouseEnter={() => setMousedOver(true)} onMouseLeave={() => setMousedOver(false)}>
          {truncatedString}
          <span style={{textDecoration: "underline"}}>...</span>
        </span>
      </>

      inner = <>
        {popupShown && makePopup(string)}
        {stringButton}
      </>
    } else {
      inner = <>
        {string}
      </>
    }
  } else if (type== "primitive") {
    inner = <>
       {remoteObj.value}
    </>
  } else if (type == "function") {
    inner = <>
      <span style={{fontStyle: "italic"}}>
        {remoteObj.value}
      </span>

    </>
  }

  //stopPropagation for onClick, otherwise Codemirror will try and highlight. This fix only works in chrome, not safari, FF not tested.
  var output = <>
    <span style={{position: "relative", textIndent: 0, marginLeft: "1ch", }}>
      <span style={{position: "absolute", width: "max-content"}}>
        <span style={{color: "hsl(230, 4%, 64%)"}} onClick={e => {e.stopPropagation()}} onMouseDown={e => {e.stopPropagation()}}>
          {inner}
        </span>
      </span>
    </span>
  </>
  return output
}
var EvalWidget = ({data, update}) => {
  var [command, setCommand] = React.useState("")
  // var [message, setMessage] = React.useState("Not run")

  var onInput = e => {
    update({codeString: e.target.value})
    setCommand(e.target.value)
  }

  // if (data?.value && message != data?.value) {
  //   setMessage(data.value)
  // }

  var subUpdate = a => update({inspectorWidget: a, codeString: command})

  var inspectorSection
  // console.log("making inspector with", data.inspectorWidget)
  inspectorSection = <>
    <InspectorWidget data={data.inspectorWidget} update={subUpdate}/>
  </>

  var output = <>
    <span>
      <textarea style={{border: "1px solid black", outline: "none", borderRadius: "5px", fontSize: "inherit", fontFamily: "inherit", padding: 4, margin: 4, marginLeft: -4}} onInput={onInput} value={command}/>
      {inspectorSection}
    </span>
  </>
  return output
}
12
var makeMarkdownWidget = ({location, widgetOptions}) => {
  var attributes = {}
  if (widgetOptions.content.trim()[0] == "#") {
    attributes.style = "font-size: large; font-weight: bold"
  }
  var widget = Decoration.mark({
    attributes,
    inclusiveStart: true
  })
  // TODO: if comment is right next to other deco (e.g. `var x = 3//#Test`), comment-deco won't apply
  var widgetWithRange = widget.range(location.start, location.end)
  return widgetWithRange
}

function CodeMirrorStateManager({docString, readOnly, scrollPos})  {
  this.state = {
    editorState: null,
    editorView: null,
    offsetMaps: {},
    interpreterID: null
  }

  //indentOnInput for jsx should be "/^\s*(?:case |default:|\{|\})$|^\s*<\/$/"
  var language = javascript({jsx: true})
  var indentOnTab = {key: "Tab", run: indentMore, shift: indentSelection}
  var decorations = new Compartment
  //codemirror object that lets us directly set facet of editor state with a transaction

  // Multiplayer Experiments
  var generateID = () => {
    var arr = new Uint8Array(6 / 2)
    var arr2 = window.crypto.getRandomValues(arr)
    var hex = Array.from(arr2, d => d.toString(16)).join("")
    return hex
  }
  var getDocumentID = () => {
    const urlParams = new URLSearchParams(window.location.search)
    var roomID = urlParams.get("room")
    if (!roomID) {
      roomID = window.localStorage.getItem("defaultRoomID")
      if (roomID == null) {
        roomID = generateID()
        window.localStorage.setItem("defaultRoomID", roomID)
      }
      var url = new URL(window.location.href);
      url.searchParams.set("room", roomID);
      url.search = url.searchParams.toString()
      window.history.pushState({}, "", url.toString())
      return roomID
    }
  }
  var documentID = getDocumentID()

  const usercolors = [
    { color: "#30bced", light: "#30bced33" },
    { color: "#6eeb83", light: "#6eeb8333" },
    { color: "#ffbc42", light: "#ffbc4233" },
    { color: "#ecd444", light: "#ecd44433" },
    { color: "#ee6352", light: "#ee635233" },
    { color: "#9ac2c9", light: "#9ac2c933" },
    { color: "#8acb88", light: "#8acb8833" },
    { color: "#1be7ff", light: "#1be7ff33" }
  ]
  const userColor = usercolors[Math.floor(Math.random()* usercolors.length)]
  const ydoc = new Y.Doc({gc: false})
  const indexeddbProvider = new IndexeddbPersistence(documentID, ydoc)
  const ytext = ydoc.getText("codemirror")

  // Snapshots functions. Some from prosemirror-versions demo
  var loadSnapshot = snapshotID => {
    const versions = ydoc.getArray("versions")
    if (snapshotID == -1) {snapshotID = versions.length - 1}
    const snapshot = Y.decodeSnapshot(versions.get(snapshotID).snapshot)
    var oldDoc = Y.createDocFromSnapshot(ydoc, snapshot)
    ydoc.transact(() => {
      ytext.delete(0, ytext.length)
      ytext.insert(0, oldDoc.getText("codemirror").toString())
    })
  }
  window.sunflower = {
    // Jank API for now
    ...(window.sunflower || {}),
    documentID,
    listSnapshots: () => ydoc.getArray("versions").toArray(),
    loadSnapshot,
  }
  const addYSnapshot = doc => {
    const versions = doc.getArray("versions")
    const prevVersion = versions.length === 0 ? null : versions.get(versions.length - 1)
    const prevSnapshot = prevVersion === null ? Y.emptySnapshot : Y.decodeSnapshot(prevVersion.snapshot)
    const snapshot = Y.snapshot(doc)
    if (prevVersion != null) {
      // account for the action of adding a version to ydoc
      prevSnapshot.sv.set(prevVersion.clientID, /** @type {number} */ (prevSnapshot.sv.get(prevVersion.clientID)) + 1)
    }
    if (!Y.equalSnapshots(prevSnapshot, snapshot)) {
      versions.push([{
        date: new Date().getTime(),
        dateReadable: new Date().toString(),
        snapshot: Y.encodeSnapshot(snapshot),
        clientID: doc.clientID
      }])
    }
  }
  const saveSnapshots = ViewPlugin.fromClass(class {
    constructor(view) {
      this.changeCounter = 0
    }
    update(update) {
      if (update.docChanged) {
        this.changeCounter++
        if (this.changeCounter > 10) {
          addYSnapshot(ydoc)
          this.changeCounter = 0
        }
      }
    }
  }, {})
  addYSnapshot(ydoc)


  indexeddbProvider.whenSynced.then(() => {
    console.log("yJS loaded data from indexedDB")
  })

  const provider = new WebrtcProvider(documentID, ydoc)
  provider.awareness.setLocalStateField("user", {
    name: "User " + Math.floor(Math.random() * 100),
    color: userColor.color,
    colorLight: userColor.light
  })


  var editorState = EditorState.create({
    doc: ytext.toString(),

    extensions: [
      yCollab(ytext, provider.awareness),
      saveSnapshots,

      lineNumbers(),
      decorations.of(EditorView.decorations.of(Decoration.set([]))),
      // myExtension(),
      oneLight,
      EditorView.exceptionSink.of(e => console.error(e)),
      EditorView.theme({"&.cm-wrap": {outline: "none", height: "100%", fontFamily: "inherit"}, ".cm-scroller": {outline: "none", fontFamily: "MonoLisa, Menlo, Monaco, 'Courier New', monospace", fontWeight: "normal", fontSize: 14}, ".cm-content": {padding: STYLE.marginXSmall}}),
      indentOnInput(),
      autocompletion({override: [completeAnyWord]}),
      ...(language ? [language] : []),
      // TODO: add back
      indentHack, // Indent on wrap
      EditorView.lineWrapping, //TODO: disabled because current decorations break lines too often, making code hard to read.
      highlightSelectionMatches(),
      bracketMatching(),
      history(),
      EditorState.tabSize.of(2),
      keymap.of([indentOnTab, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...commentKeymap]),
    ],
  })

  this.scrollPos = () => {
    const pos = this.state.editorView.scrollDOM.scrollTop
    return pos
  }

  this.startOffsetMap = (id, docLength) => {
    this.state.offsetMaps[id] = ChangeSet.empty(docLength)
    console.log("Creating new offset map ID:", id, this.state.offsetMaps[id])
  }

  const debugrangesetItems = set => {
    // if (!set) {return []}
    var items = []
    var iter = set.iter()
    while (iter.value) {
      items.push({text: iter.value.spec, start: iter.from, end: iter.to})
      iter.next()
    }
    return items
  }

  this.offsetMapExists = (offsetMapID) => {
    return !!this.state.offsetMaps[offsetMapID]
  }

  this.mapLocationWithOffsetMap = (offsetMapID, location, invert) => {
    var offsetMap = this.state.offsetMaps[offsetMapID]
    var offsetMap = invert ? offsetMap.invertedDesc : offsetMap
    const mappedLocation = offsetMap.mapPos(location)
    return mappedLocation
  }

  this.setDecorations = (keyedAnnotations) => {
    // console.log("In setDecorations", Object.keys(keyedAnnotations), {keyedAnnotations}, {text: this.getText()})
    this.state.offsetMaps
    var newDecorations = Decoration.none //equal to RangeSet.empty
    Object.entries(keyedAnnotations).forEach(([offsetMapID, ranges]) => {
      var newlineInserted = changes => {
        return (
          changes.inserted?.[1]?.text?.[0]?.trim() == "" && changes.inserted?.[1]?.text?.[1]?.trim() == ""
        )
      }
      var decos = Decoration.set(ranges, true)
      const offsetMap = this.state.offsetMaps[offsetMapID]
      var newlineDeco
      if (newlineInserted(offsetMap)) {
        // console.log("SETDECOS newline inserted afr2")
        const newlineLocation = offsetMap.sections[0]
        decos.between(newlineLocation, newlineLocation+1, (from, to, val) => {
          newlineDeco = val
        })
      }
      // console.log("SETDECOS before mapping decos afr2", debugrangesetItems(decos), offsetMapID)
      if (newlineDeco) {newlineDeco.startSide =-1; newlineDeco.endSide=-1}
      decos = decos.map(offsetMap)
      if (newlineDeco) {newlineDeco.startSide =1; newlineDeco.endSide=1}
      // console.log("SETDECOS after mapping decos afr2", debugrangesetItems(decos), offsetMapID)

      var ranges = []
      var iter = decos.iter()
      while (iter.value) {
        const range = new Range(iter.from, iter.to, iter.value)
        ranges.push(range)
        iter.next()
      }

      newDecorations = newDecorations.update({add: ranges, sort: false})
    })

    this.state.editorView.dispatch({
      effects: decorations.reconfigure(EditorView.decorations.of(newDecorations)),
    })

  }
  this.getDecorations = () => {
    return decorations.get(this.state.editorState).value
  }

  function dispatchFunction(transaction) {
    const calculateTotalDecoCount = state => {
      var total = 0
      var items = []
      state.facet(EditorView.decorations).forEach(rangeSet => {
        total += rangeSet.size
        var iter = rangeSet.iter()
        while (iter.value) {
          items.push({text: iter.value.spec?.widget, start: iter.from, end: iter.to})
          iter.next()
        }
      })
      return items
    }
    // console.log("Tx dispatched", transaction)

    if (readOnly) {
      if (this.state.editorView.state.doc != transaction.newDoc) {
        return
      }
    }

    var newTransaction
    // Instead of this, can also look into  transactionExtender
    if (transaction.docChanged) {
      var newlineInserted = transaction => {
        return (
          transaction.changes.inserted[1]?.text?.[0]?.trim() == "" && transaction.changes.inserted[1]?.text?.[1]?.trim() == ""
        )
      }

      // console.log("DISPATCH offsetmaps afr2", this.state.offsetMaps)
      Object.keys(this.state.offsetMaps).forEach(offsetMapID => {
        this.state.offsetMaps[offsetMapID] = this.state.offsetMaps[offsetMapID].composeDesc(transaction.changes)
      });

      var currentDecorations = decorations.get(transaction.state).value

      // Modify the assoc of the deco at the newline, so that it won't go to the newline when mapped
      var newlineDeco
      if (newlineInserted(transaction) && transaction.selection?.ranges) {
        // console.log("DISPATCH newline inserted afr2")
        // Get point where cursor went down from
        const newlineLocation = transaction.startState.selection.ranges[0].from
        currentDecorations.between(newlineLocation, newlineLocation+1, (from, to, val) => {
          newlineDeco = val
        })
      }
      // console.log("DISPATCH before mapping decos afr2", debugrangesetItems(currentDecorations))
      if (newlineDeco) {newlineDeco.startSide =-1; newlineDeco.endSide=-1}
      var mappedDecorations = currentDecorations.map(transaction.changes)
      if (newlineDeco) {newlineDeco.startSide =1; newlineDeco.endSide=1}
      // console.log("DISPATCH after mapping decos afr2", debugrangesetItems(mappedDecorations))

      var effect = decorations.reconfigure(EditorView.decorations.of(mappedDecorations))
      newTransaction = transaction.state.update({effects: [effect]})
    }

    var txes = [transaction]
    if (newTransaction) {
      txes.push(newTransaction)
    }
    this.state.editorView.update(txes)
    this.state.editorState = this.state.editorView.state

    // Important that this runs last, otherwise deco offset maps will be incorrect
    if (transaction.docChanged && typeof this.onChangeUpdate == "function") {
      this.onChangeUpdate()
    }
  }

  this.getText = () => {
    return this.state.editorState.doc.toString()
  }


  var dispatchRef = {current: dispatchFunction.bind(this)}
  // useHandler(f => {
  //   dispatchRef.current = f.bind(this)
  // }, "dispatchFunction")
  var editorView = new EditorView({
    state: editorState,
    dispatch: (...args) => dispatchRef.current(...args),
  })

  console.log("Timeout to scroll to", scrollPos)
  // Not cool but will have to do. Should somehow wait until codemirror has added overflowY style AND loaded requisite stuff in
  setTimeout(() => {
    //window.getComputedStyle(editorView.scrollDOM).overflowY
    console.log("Timeout running to scroll to", scrollPos)
    editorView.scrollDOM.scrollTop = scrollPos
  }, 500)

  this.state.editorState = editorState
  this.state.editorView = editorView
}

var CodeRunner = props => {
  var iframeRef = React.useRef()
  const {codeString, editorStateManager, onNeedsReload, setErrorNotifications, onLoadCode, shouldPushAnnotations} = props

  var [workerID, setWorkerID] = React.useState(null)

  // DEBUG: todo: change back to localhost to get cross-domain own-thread benefits
  const iframeSrc = `${location.protocol}//${location.hostname}:2001/runner.html`
  const postFrameMessage = (msg, port) => {
    msg = {from: "interpreterController", ...msg, interpreterID: workerID}
    iframeRef.current.contentWindow.postMessage(msg, iframeSrc, port)
  }

  var shouldPushAnnotationsRef = React.useRef()
  React.useEffect(() => {
    shouldPushAnnotationsRef.current = shouldPushAnnotations
  }, [shouldPushAnnotations])

  var setupFrameListener = () => {
    var annotationsBySnippetID = {} //[snippetID]: {annotations, codeVersionID}
    var errorsBySnippetID = {} //[snippetID]: []
    // When new code comes for same snippetID (since snippet ID is tied to name of handled fn), will erase its old annotations.
    var registeredWidgets = {}
    var timeouts = {}
    var pushDecorations = () => {
      if (Object.keys(annotationsBySnippetID).length == 0) {
        //updateDebounceTimeout(pushDecorations)
        //return
        // Disabled because empty code will keep calling this
        // for some reason the first timeout/call to pushDecos has 0, then the second timeout/call has alot (incl important postTransform ones)
        // TODO: make postTRansform widgets showing up more reliable
      }
      if (shouldPushAnnotationsRef.current) {
        var annotationsByCodeVersionID = {}
        Object.values(annotationsBySnippetID).forEach(({codeVersionID, annotations}) => {
          if (!annotationsByCodeVersionID[codeVersionID]) {
            annotationsByCodeVersionID[codeVersionID] = []
          }
          annotationsByCodeVersionID[codeVersionID] = annotationsByCodeVersionID[codeVersionID].concat(Object.values(annotations))
        })
        editorStateManager.setDecorations(annotationsByCodeVersionID)
        //annotations is ----- [codeVersionID]: list of decorations
        var allErrors = []
        Object.values(errorsBySnippetID).forEach(errs => {
          allErrors = [...allErrors, ...errs]
        })
        setErrorNotifications(allErrors)
      }
    }
    var updateDebounceTimeout = update => {
      const delay = 1000/30
      if (timeouts["pushBatch"] == null) {
        timeouts["pushBatch"] = setTimeout(() => {
          // console.log("making timeout")
          timeouts["pushBatch"] = null
          pushDecorations()
        }, delay)
      }
    }

    var onWorkerMessage = e => {
      // TODO: below will always return true
      const interpreterID = workerID

      if (e.data.interpreterID != interpreterID) {return}
      if (e.data.markdownWidget) {
        // const key = e.data.markdownWidget.location.start
        // var widget = makeMarkdownWidget(e.data.markdownWidget)
        // annotations[key] = widget
      } else if (e.data.registerWidget) {
        const {display, displayComponentName, widgetClassID} = e.data.registerWidget
        // Either register widget by serialized function, or name of React Component here.
        if (displayComponentName) {
          registeredWidgets[widgetClassID] = eval(displayComponentName)
        } else {
          // Deserialize the function
          registeredWidgets[widgetClassID] = Function('return ('+display+')')()(React)
        }
        // console.log("Registered (React) Widget", registeredWidgets[widgetClassID])
      } else if (e.data.parseSuccess) {
        errorsBySnippetID["SyntaxError"] = []
        if (annotationsBySnippetID["ParseCheckingCode"]) {
          annotationsBySnippetID["ParseCheckingCode"].annotations = {}
        }
        clearTimeout(timeouts["SyntaxError"])
      }
      else if (e.data.callWidget) {
        const {data, widgetClassID, widgetInstanceID, codeVersionID, codeSnippetID, location, isBlock, errorType, syntaxError} = e.data.callWidget
        if (location == undefined) {
          console.warn("Widget call with undefined location, not correct", e)
          return
        }

        if (!annotationsBySnippetID[codeSnippetID]) {
          annotationsBySnippetID[codeSnippetID] = {codeVersionID, annotations: {}}
        }

        // TODO: urgent: quick fix for clearing annotations of replaced-handlers. But really should just replace old annotations.
        if (annotationsBySnippetID[codeSnippetID].codeVersionID != codeVersionID) {
          console.log("Clearing annotations for snipped ID", codeSnippetID)
          annotationsBySnippetID[codeSnippetID] = {codeVersionID, annotations: {}}
          errorsBySnippetID[codeSnippetID] = []
        }
        // if there's an annotation at this location from the initial (non handler) run, clear it. This should actually run for all codeSnippetIDs
        const locationRunnerVM = annotationsBySnippetID["RunnerVMInitial"] && editorStateManager.mapLocationWithOffsetMap(annotationsBySnippetID["RunnerVMInitial"].codeVersionID, location, true)
        if (annotationsBySnippetID["RunnerVMInitial"]?.annotations[locationRunnerVM]) {
          delete annotationsBySnippetID["RunnerVMInitial"].annotations[locationRunnerVM]
        }

        var addInspectorWidget = () => {
          const sendUpdateMessage = data => postFrameMessage({sendMessageToWidget: {
              data, widgetClassID, widgetInstanceID, codeVersionID, codeSnippetID, interpreterID, location
          }})
          const WidgetClass = registeredWidgets[widgetClassID]
          var reactProps = {data, update: sendUpdateMessage}
          const mappedLocation = editorStateManager.mapLocationWithOffsetMap(codeVersionID, location)
          const indent = isBlock && getIndentation(editorStateManager.state.editorState, mappedLocation)
          var widget = Decoration.widget({
            widget: new ReactWidget(<WidgetClass {...reactProps}/>, {indent, isBlock}),
            side: 1, // draw after cursor
            block: isBlock,
          })
          var widgetWithRange = widget.range(location, location)
          annotationsBySnippetID[codeSnippetID].annotations[location] = widgetWithRange
        }

        if (errorType && widgetClassID == "inspectorWidget") {
          // Run error or Promise error
          if (!shouldPushAnnotationsRef.current) {return}
          // console.log(data)
          const newErrorNotif = {show: true, message: data.remoteObj.message || data.remoteObj.value, location, type: errorType, interpreterID, key: Math.random(), closeable: true}
          errorsBySnippetID[codeSnippetID] = errorsBySnippetID[codeSnippetID] || []
          errorsBySnippetID[codeSnippetID].push(newErrorNotif)
          errorsBySnippetID
        } else if (syntaxError && widgetClassID == "inspectorWidget") {
          // codeSnippetID will be ParseCheckingCode
          // Syntax error
          const newErrorNotif = {show: true, message: data.remoteObj.message, location, type: "parse"}
          clearTimeout(timeouts["SyntaxError"])
          timeouts["SyntaxError"] = setTimeout(() => {
            if (!shouldPushAnnotationsRef.current) {return}
            errorsBySnippetID["SyntaxError"] = []
            errorsBySnippetID["SyntaxError"].push(newErrorNotif)
            addInspectorWidget()
            pushDecorations()
          }, 5000)
          return
        }
        addInspectorWidget()
      }
      updateDebounceTimeout(pushDecorations)
    }
    window.addEventListener("message", onWorkerMessage)
    var cleanup = () => {
      window.removeEventListener("message", onWorkerMessage)
      Object.keys(timeouts).forEach(k => {
        clearTimeout(timeouts[k])
      })
    }
    return cleanup
  }

  // Warning: codeString can change after this is called
  React.useEffect(() => {
    if (workerID == null) {return} //Don't run on first call when no worker yet
    const parentOrigin = window.location.origin
    // Fresh worker -- reloaded window. Initialize it.
    postFrameMessage({initialize: {interpreterID: workerID, parentOrigin}})

    var cleanupFrameListener = setupFrameListener()
    var cleanup = () => {
      cleanupFrameListener()
    }
    return cleanup
  }, [workerID])

  React.useEffect(() => {
    const effectID = String(Math.random()*100).slice(0, 2)
    if (!iframeRef.current || codeString == undefined || workerID == null) {return}

    // For methods that don't change state
    var asyncResponse = (msg, onSuccess) => {
      var msg = {effectID, ...msg}
      var channel = new MessageChannel()
      postFrameMessage(msg, [channel.port2])
      channel.port1.onmessage = e => {
        onSuccess(e.data)
      }
      var cancel = () => {
        channel.port1.onmessage = () => {}
      }
      return cancel
    }

    var codeVersionID = Math.random() //TODO: incrementing ID
    // This needs to start before the editor's next transaction goes through -- while the editors text still matches codeString
    editorStateManager.startOffsetMap(codeVersionID, codeString.length)

    // What if iframe is errored out and we can't call anything? Not sure if possible
    var pending = []
    pending.push(asyncResponse({checkParseError: {codeString, codeVersionID}}, res => {

      var {codeParses} = res
      if (!codeParses) {
        // WARNING: this only works because of the order of the messages in worker (first response is sent, then handler adds widgets(
        return
      }
      pending.push(asyncResponse({startedRun: true}, res => {
        const {startedRun} = res
        startedRun
        if (startedRun) {
          // User code is running. Try and hotswap
          pending.push(asyncResponse({checkAddHandlers: {codeString, codeVersionID}}, res => {
            var {success} = res
            if (success) {
              // worker was able to hot patch
            } else {
              // Inform that relad needed
              var disabled = false
              var setDisabled = () => {disabled = true}
              pending.push(setDisabled)
              onNeedsReload(() => {
                console.log("Posting reload request")
                disabled && console.log("Hook cleanup, not doing reload")
                !disabled && postFrameMessage({reload: true})
              })
            }
          }))
        } else {
          // Fresh worker, so no code running. Need to give it code
          // WARNING: this will still be called even if activeCode is ""
          console.log("Posting run code", workerID)
          postFrameMessage({runCode: {codeString, codeVersionID}})
          onLoadCode()
        }
      }))
    }))

    var cleanup = () => {
      pending.forEach(cancel => cancel())
    }
    return cleanup
    // Worker should be loaded at this point, but could be in process of reloading (for whatever reason)
    // 1. use worker to check if there are parse errors, have it add them if there are. responds
    // If there are no parse errors then try and add handlers, have it try and do that. responds
    // If responses both come in and are no-syntax-error, couldn't-add-handlers, then reload and run the code
    // If iframe is in process of loading, then the syntax-error-res and handler-add res will never come in. But that's ok, since this effect will be called again when iframe does load

    // In cleanup, cancel any timeouts / waiting (checking for parse, handler stuff)
  }, [codeString, iframeRef.current, workerID])

  var onLoad = () => {
    setWorkerID(Math.random())
  }

  var output = <>
    <iframe src={iframeSrc} ref={iframeRef} onLoad={onLoad} style={{border: "none", width: "100%", height: "100%", overflow: "auto"}} allow="autoplay;camera;microphone">
    </iframe>
  </>
  return output
}

var ErrorNotification = ({title, content, onClick, color, ID, closeable, setHiddenErrorIDs}) => {
  var hideNotif = () => {
    setHiddenErrorIDs(IDs => ([...IDs, ID]))
  }
  var [closeButtonColor, setCloseButtonColor] = React.useState("unset")
  var jsx = <React.Fragment key={ID}>
    <div onClick={onClick} style={{cursor: "pointer", borderRadius: 5, backgroundColor: color, color: "white", padding: STYLE.marginXSmall/2, paddingLeft: STYLE.marginXSmall, display: "flex", alignItems: "center"}}>
      <span style={{fontWeight: "bold"}}>{title}</span>
      {content}
      &nbsp;
      {closeable && <AiOutlineCloseCircle onClick={hideNotif} style={{color: closeButtonColor, borderRadius: "100%"}} onMouseEnter={() => setCloseButtonColor("black")} onMouseLeave={() => setCloseButtonColor("unset")}/>}
    </div>
  </React.Fragment>
  return jsx

}

var EditorCode = props => {

  var {sourceState, setSourceState} = props

  var sourceNames = Object.keys(sourceState)
  var [activeTab, setActiveTab] = React.useState(sourceNames[0])

  // One editor state for each tab
  var [tabStates, setTabStates] = React.useState({})

  // Debounce updates every second. Also, force updates every 5 seconds (debounce won't run when widgets are changing the tabState every frame)
  const minUpdateInterval = 5000
  var lastUpdate = React.useRef(Date.now())
  const debounceTimeoutLength = 1000
  var debounceTimeout = React.useRef()

  var sourceUpdate = tab => {
    if (tabStates[tab]) {
      // Use callback or will have stale oldSourceState problem
      setSourceState(oldSourceState => {
        var newSourceState = {...oldSourceState}
        newSourceState[tab].text = tabStates[tab].getText()
        // Might wanna put scroll update elsewhere, since user might scroll and not dispatch tx
        newSourceState[tab].scrollPos = tabStates[tab].scrollPos()
        return newSourceState
      })
    }
  }
  React.useEffect(() => {
    var doUpdate = () => {
      sourceUpdate(activeTab)
      lastUpdate.current = Date.now()
    }
    if (Date.now() - lastUpdate.current > minUpdateInterval) {
      doUpdate()
    }
    clearTimeout(debounceTimeout.current)
    debounceTimeout.current = setTimeout(doUpdate, debounceTimeoutLength)
  }, [tabStates])
  React.useEffect(() => sourceNames.forEach(tab => sourceUpdate(tab)), [activeTab])

  var makeTabs = names => {
    var makeTab = name => {
      return content
    }
    var tabs = []
    names.forEach((name, idx) => {
      const activeTabColor = "white"//"#282c34"//"#151718"
      const inactiveTabColor = "#eee"

      var spacerColor = activeTabColor
      var isActiveTab = activeTab == name
      var onClick = () => setActiveTab(name)
      var backgroundColor = isActiveTab ? activeTabColor : inactiveTabColor
      var color = isActiveTab ? "black" : "gray"
      var tab = <React.Fragment key={name}>
        <div onClick={onClick} style={{backgroundColor, color, cursor: "pointer", ...userSelectNone, fontWeight: "normal", fontSize: 15, padding: "3px 9px"}}>
          {name}
        </div>
      </React.Fragment>
      tabs.push(tab)
      var nextName = names[idx + 1]
      if ((nextName != activeTab || !nextName) && name != activeTab) {
        spacerColor = "#ccc"
      }
      var spacer = <React.Fragment key={name+"spacer"} >
        <div style={{minWidth: 1, backgroundColor: spacerColor}}></div>
      </React.Fragment>


      tabs.push(spacer)
    })
    return tabs


  }
  var tabs = React.useMemo(() => makeTabs(sourceNames), [sourceNames.toString(), activeTab])
  var tabsArea = <>
    <div style={{display: "flex", justifyContent: "left", width: "100%", backgroundColor: "f0f0f0"}}>
      {tabs}
      <a href="https://twitter.com/sunflowerindust" target="_blank" style={{textDecoration: "none", marginLeft: "auto", alignSelf: "center"}}>
        <img src={logoImage} style={{height: 18, paddingRight: 5}}/>
      </a>
    </div>
  </>

  var tabState = tabStates[activeTab]
  if (!tabState) {
    var language = javascript({jsx:true})

    var docString = sourceState[activeTab].text
    var scrollPos = sourceState[activeTab].scrollPos
    var tabStateManager = new CodeMirrorStateManager({docString, scrollPos})
    tabStateManager.onChangeUpdate = () => {
      // Fires when document (i.e. actual text) changes
      // console.log("In tabStateManager onupdate", tabStateManager.state.editorState.facet(EditorView.decorations)[0].size)
      setTabStates(oldTabStates => {
        return {...oldTabStates, [activeTab]: tabStateManager}
      })
    }
    setTabStates({...tabStates, [activeTab]: tabStateManager})
  }

  // Error Popups Code
  var [hiddenErrorIDs, setHiddenErrorIDs] = React.useState([])
  var [errorNotifications, setErrorNotifications] = React.useState([]) // {message, type, location, value, show}
  var errorsNotificationsElements = errorNotifications.filter(notif => !hiddenErrorIDs.includes(notif.key)).map(notif => {
    if (!notif.show) {return undefined}
    var onClick = () => tabStates[activeTab].state.editorView.scrollPosIntoView(notif.location)
    var title
    var color
    if (notif.type == "run") {
      title = "Run Error: "
      color = "red"
    } else if (notif.type == "promise") {
      title = "Unhandled Promise Error: "
      color = "red"
    } else if (notif.type == "parse") {
      title = "Syntax Error: "
      color = "rgb(250, 230, 105)"
    }
    // console.log({obj: notif})
    var jsx = <ErrorNotification {...{title, content: notif.message, onClick, color, ID: notif.key, closeable: notif.closeable, setHiddenErrorIDs}}/>
    return jsx
  })
  // var dismissRunErrors = () => {
  //   setErrorNotifications(notifs => notifs.filter(er => er.type != "run"))
  // }
  // var dismissParseErrors = () => {
  //   setErrorNotifications(notifs => notifs.filter(er => er.type != "parse"))
  // }

  var activeCode = tabStates[activeTab]?.getText()


  // Code for transition between iframes. Works by defining progression of prop changes as well as functions to revert if the effect has to cleanup at any point in the process.
  var [activeFrameIdx, setActiveFrameIdx] = React.useState(0)
  var inactiveFrameidx = 1 - activeFrameIdx
  var [frameProps, setFrameProps] = React.useState({})
  React.useEffect(() => {
    const effectID = String(Math.random()*1000).slice(0, 3)
    var updateFrameProps = (idx, newProps) => {
      // console.log(`Effect ${effectID} frame props set`, idx, newProps)
      setFrameProps(frameProps => {
        var newFrameProps = {...frameProps}
        newFrameProps[idx] = {
          ...newFrameProps[idx],
          ...newProps,
          style: {...newFrameProps[idx]?.style, ...newProps.style}
        }
        return newFrameProps
      })
    }

    const transition = "opacity 500ms ease-in-out, filter 250ms ease-in-out"
    const frameContainerStyle = {position: "absolute", width: "100%", height: "100%"}

    var revert
    console.log(`Effect ${effectID} Running`, "active is", activeFrameIdx)

    var updateDecoVisiblity = (doShowFrame, dontShowFrame) => {
      // console.log(`Effect ${effectID} deco visibility set`, doShowFrame, dontShowFrame)
      updateFrameProps(doShowFrame, {
        shouldPushAnnotations: true,
      })
      updateFrameProps(dontShowFrame, {
        shouldPushAnnotations: false,
      })
    }
    var tryUpdateActive = () => {
      console.log(`Effect ${effectID} Trying update active`)
      revert = () => {
        console.log(`Effect ${effectID} Reverting from updating active??`)
      }
      // Problems when codeString doesn't change (e.g. add and del quickly) => need this
      updateFrameProps(inactiveFrameidx, {
        codeString: "",
        shouldPushAnnotations: false,
        onLoadCode: () => {},
      })
      updateFrameProps(activeFrameIdx, {
        style: {opacity: 1, zIndex: 1, pointerEvents: "unset", transition, filter: "none", ...frameContainerStyle},
        codeString: activeCode,
        onLoadCode: () => {},
        editorStateManager: tabStates[activeTab],
        shouldPushAnnotations: true,
        setErrorNotifications,
        onNeedsReload: reload => {
          console.log(`Effect ${effectID} Reload needed on active`)
          revert = () => {
            console.log(`Effect ${effectID} Reverting inactive back to inactive`)
            updateFrameProps(inactiveFrameidx, {
              codeString: "",
              onNeedsReload: reload => reload(),
              onLoadCode: () => {},
            })
          }
          updateFrameProps(inactiveFrameidx, {
            style: {opacity: 0.0, transition, zIndex: 0, pointerEvents: "none", filter: "none", ...frameContainerStyle},
            codeString: activeCode,
            onNeedsReload: reload => reload(),
            onLoadCode: () => {
              console.log(`Effect ${effectID} Inactive loaded, timing out for its page load`)

              // Inactive frame loaded so start showing its decos
              updateDecoVisiblity(inactiveFrameidx, activeFrameIdx)

              // Timeout for when its dom will start showing
              var waitForPageReady = setTimeout(() => {
                console.log(`Effect ${effectID} Beginning CSS transition`)
                updateFrameProps(activeFrameIdx, {
                  style: {opacity: 0.0, transition, filter: "blur(2px)"},
                })
                updateFrameProps(inactiveFrameidx, {
                  style: {opacity: 1, transition, filter: "blur(2px)"},
                })

                var waitForTransition = setTimeout(() => {
                  console.log(`Effect ${effectID} Unloading active and swapping idx`)
                  updateFrameProps(activeFrameIdx, {
                    style: {opacity: 0.0, transition, filter: "none", zIndex: 0.2, pointerEvents: "none"},
                    codeString: "",
                    onNeedsReload: reload => reload()
                  })
                  updateFrameProps(inactiveFrameidx, {
                    style: {opacity: 1, transition, filter: "none", zIndex: 1, pointerEvents: "unset"}
                  })
                  setActiveFrameIdx(inactiveFrameidx)
                  revert = () => {}
                }, 500)
                revert = () => {
                  console.log(`Effect ${effectID} Cancelling slow fade`)
                  clearTimeout(waitForTransition)
                  updateDecoVisiblity(activeFrameIdx, inactiveFrameidx)
                  // TODO: transition needs to revert back slowly. Since can't do that in cleanup, can add a ref and have, at the beginning of this effect, a transition back
                }
              }, 1500)
              revert = () => {
                console.log(`Effect ${effectID} Cancelling code load-time timeout`)
                updateDecoVisiblity(activeFrameIdx, inactiveFrameidx)
                clearTimeout(waitForPageReady)
              }
            },
            shouldPushAnnotations: true,
            editorStateManager: tabStates[activeTab],
            setErrorNotifications
          })
        }
      })
    }
    tryUpdateActive()

    var cleanup = () => {
      console.log(`Effect ${effectID} cleanup called`, revert)
      if (revert) {
        revert()
      } else {}
    }
    return cleanup
  }, [activeCode, tabStates[activeTab]])

  // Frames might not be ready until above effect runs once. TODO: make cleaner
  var showFrame = idx => (frameProps[idx]?.codeString != undefined) && frameProps[idx]?.editorStateManager;

  // (frameProps[0]?.shouldPushAnnotations && frameProps[1]?.shouldPushAnnotations) ? console.log("both pushing", frameProps) : console.log("not both", frameProps, {activeCode})
  // console.log(frameProps)

  frameProps
  var frames = <>
    {/* <div style={{display: "grid", gridTemplateRows: "1fr 1fr"}}> */}
    <div style={{overflow: "hidden", minWidth: "30%", position: "relative"}}>
      <div style={frameProps[0]?.style}>
        {showFrame(0) &&<CodeRunner {...{...frameProps[0], style: undefined}}/>}
      </div>
      <div style={frameProps[1]?.style}>
        {showFrame(1) &&<CodeRunner {...{...frameProps[1], style: undefined}}/>}
      </div>
    </div>
  </>
  var content = <>
    <div style={{display: "flex", flexDirection: "row", height: "100%"}}>
      {frames}
      <div style={{height: "100%", minWidth: "1px", backgroundColor: "rgb(240, 240, 240)"}}></div>
      <div style={{display: "grid", gridTemplateRows: "min-content minmax(0, 1fr)", flexGrow: 1}}>
        {tabsArea}
        <div style={{backgroundColor: "#white", padding: 0, position: "relative", overflow: "auto"}}>
          <CodeMirrorRenderer fullState={tabStates[activeTab]?.state} />
          <div style={{position: "absolute", top: STYLE.marginXSmall, right: STYLE.marginXSmall}}>
            {errorsNotificationsElements}
          </div>
        </div>
      </div>
    </div>
  </>

  return content
}

var CodeMirrorRenderer = props => {

  var {fullState, setFullState} = props

  var codeMirrorContainerRef = React.useRef()
  var codeMirrorContainer = <>
    <div style={{height: "100%"}} ref={codeMirrorContainerRef}/>
  </>

  var m = 2

  React.useEffect(() => {
    if (!codeMirrorContainerRef || !fullState.editorView) return

    codeMirrorContainerRef.current.appendChild(fullState.editorView.dom)
    // fullState.editorView.focus()
    // TODO: this is sometimes buggy when pasting, so there must be a better method.
    // fullState.editorView.scrollDOM.scrollTop = fullState.scrollTop
    var cleanup = () => {
      // var scrollTop = fullState.editorView.scrollDOM.scrollTop
      // setFullState(oldState => ({...oldState, scrollTop}))
      fullState.editorView?.dom.parentNode.removeChild(fullState.editorView.dom)
    }
    return cleanup
  }, [fullState.editorView.dom, codeMirrorContainerRef])

  return codeMirrorContainer
}

var Link = props => {
  var output = <>
    <RawLink to={props.to} style={{color: "unset", textDecoration: "none"}}>
      {props.children}
    </RawLink>
  </>
  return output
}

ReactDOM.render(<App/>, document.querySelector("#root"))
