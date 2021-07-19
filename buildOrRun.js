const path = require('path');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin')
var webpack = require('webpack')
const WebpackDevServer = require("webpack-dev-server")
const TerserPlugin = require("terser-webpack-plugin");

var devServerOrBuild = process.argv[2]
if (!(devServerOrBuild == "server" || devServerOrBuild == "build")) {
  console.error(`ERROR: Pass "server" or "build" as argument`)
  return
}
const address = process.argv[3] || "localhost"
const outDir = devServerOrBuild == "build" ? process.argv[3] : "dist"

var moduleOptions = {
  noParse: /\@babel\/standalone/,
  rules: [
    {
      test: /\.(js|jsx)$/,
      exclude: /node_modules/,
      use: {
        loader: 'babel-loader',
        options: {
          "presets": ["@babel/preset-react"],
          "plugins": []
        },
      }
    },
    {
      test: /\.(png|svg|jpg|jpeg|gif)$/i,
      exclude: /node_modules/,
      type: 'asset/resource',
    },
  ],
}

var webpackConfig = [{
  mode: devServerOrBuild == "server" ? "development" : "production",
  entry: path.resolve(__dirname, 'editor.jsx'),
  optimization: {
    minimize: devServerOrBuild == "server" ? false : true,
    minimizer: [new TerserPlugin({
    })],
  },
  plugins: [
  ],
  module: moduleOptions,
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, outDir),
  },
}, {
  mode: devServerOrBuild == "server" ? "development" : "production",
  entry: path.resolve(__dirname, 'interpreterWorker.js'),
  plugins: [
    // Needed for babel-standalone, I think
    new NodePolyfillPlugin(),
    new webpack.ProvidePlugin({
      process: 'process/browser.js'
    })
  ],
  module: moduleOptions,
  output: {
    filename: 'runner.js',
    path: path.resolve(__dirname, outDir),
  },
}]

const compiler = webpack(webpackConfig)

// BUILD
if (devServerOrBuild == "build") {
  compiler.run((err, stats) => { // [Stats Object](#stats-object)
    if (err) {
      console.error(err);
      return;
    }

    console.log(stats.toString({
      chunks: false,  // Makes the build much quieter
      colors: true    // Shows colors in the console
    }))

    compiler.close((closeErr) => {
      // ...
    });
  });
}
// RUN SERVER
else {
  const server1 = new WebpackDevServer(compiler.compilers[0], {
    index: "index.html",
    contentBase: path.join(__dirname, 'dist'),
    compress: true,
    disableHostCheck: true,
    https: false,
    historyApiFallback: true,
  })

  const server2 = new WebpackDevServer(compiler.compilers[1], {
    index: "runner.html", //Doesn't work, need to navigate to http://localhost:1235/runner.html
    contentBase: path.join(__dirname, 'dist'),
    compress: true,
    disableHostCheck: true,
    https: false,
    historyApiFallback: {index: "/runner.html"},
  })

  server1.listen(2000, address, function() {})
  server2.listen(2001, address, function() {})
}
