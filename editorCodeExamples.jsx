var replExample = `
// ------------------------------ REPL EXAMPLE ------------------------------


var repl = () => {
  var x = new Date()
  x.toString()

  // Try adding some code here and watch it instantly update




}

repl()


// useHandler will be passed the new version of the function "repl" whenever it changes. The rest of the code will not refresh.
useHandler(newF => {
  newF()
}, "repl")
`

var inspectorExample = `
// --------------------- BASIC EXAMPLE ---------------------


// First click on the pane on the left and move the mouse around.
// Then click on "MouseEvent" to see the value of the event object
window.onmousemove = e => {
  e
}
`

var domExample = `

// ------------------------------ DOM EXAMPLE  ------------------------------


// The dom content is on the left, and will refresh every time the code here is edited.

var body = document.querySelector("body")
var div = document.createElement("div")
div.innerHTML = "Hello World"
div.style.cssText = \`
  padding: 15px;
  font-size: 40px;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0px 0px 3px #ccc;
  margin-top: 120px;
  margin-left: 20px;
  margin-right: 20px;
  color: blue\`
body.appendChild(div)
`

var reactExample = `

// --------------------- REACT EXAMPLE ---------------------


// When imports aren't have a url, they will automatically be fetched from NPM via jspm.dev
// For example, the below import is transformed into: import React from "https://jspm.dev/react"
import React from "react"
import ReactDOM from "react-dom"


// Try editing this component!
var AppRaw = props => {
  Date.now()
  var out = <>
    <Child/>
  </>
  return out
}
var App = enableFastRefresh("AppRaw")


// Or try editing this component! Watch how the values change when you click the button on the left. The parent component (App) will not re-render when you edit this.
var ChildRaw = props => {
  var [count, setCount] = React.useState(0)

  count
  Date.now()

  var doStuff = e => {
    setCount(c => c+1)
  }

  // Try changing the style!
  var out = <>
    <div style={{padding: 30, backgroundColor: "green", margin: 30}}>
      <button onClick={doStuff}>Click Me {count}</button>
    </div>
  </>
  return out
}
var Child = enableFastRefresh("ChildRaw")


var root = document.createElement("div")
document.querySelector("body").appendChild(root)
ReactDOM.render(<App/>, root)





// Below is the machinery for enabling the fast refresh. "useHandler" is the key function.
// --------------------- ---------------------

function FastRefreshComponent(props) {
  var [CurrentComponent, setCurrentComponent] = React.useState({current: props.component})
  React.useEffect(() => {
    var remove = useHandler(newComponent => {
      setCurrentComponent({current: newComponent})
    }, props.componentName)
    return remove
  })

  class ErrorBoundary extends React.Component {
    constructor(props) {
      super(props);
      this.state = { hasError: false, showedFallback: false };
    }
    static getDerivedStateFromError(error) {
      // Update state so the next render will show the fallback UI.
      return { hasError: true };
    }
    render() {
      if (this.state.hasError) {
        this.state.hasError = false
        return "ComponentErrored"
      }
      return this.props.children;
    }
  }

  var componentProps = {...props, component: undefined, componentName: undefined}
  return <>
    <ErrorBoundary>
      <CurrentComponent.current {...componentProps}/>
    </ErrorBoundary>
  </>
}

function enableFastRefresh(name) {
  var newComponent = props => <>
    <FastRefreshComponent component={eval(name)} componentName={name} {...props}/>
  </>
  return newComponent
}
`

const examples = {replExample, inspectorExample, domExample, reactExample}
export default examples
