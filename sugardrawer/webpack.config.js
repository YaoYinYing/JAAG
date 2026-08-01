const HtmlWebpackPlugin = require("html-webpack-plugin");
const path = require("path");

module.exports = (_env, argv = {}) => {
    const production = argv.mode === "production";
    const src = path.resolve(__dirname, "src");

    return {
        mode: production ? "production" : "development",
        entry: {app: path.join(src, "js/main.js")},
        output: {
            path: path.resolve(__dirname, "dist"),
            filename: "[name].bundle.js"
        },
        devtool: "source-map",
        module: {
            rules: [
                {
                    test: /\.js$/,
                    exclude: /node_modules|bower_components/,
                    loader: "babel-loader",
                    options: production ? {comments: false, compact: true} : {}
                },
                {test: /\.css$/, use: ["style-loader", "css-loader"]},
                {
                    test: /\.(jpg|png)$/,
                    use: [{loader: "file-loader", options: {name: "[path][hash].[ext]", outputPath: "/"}}]
                },
                {
                    test: require.resolve("createjs-easeljs"),
                    use: ["imports-loader?this=>window", "exports-loader?window.createjs"]
                }
            ]
        },
        plugins: [new HtmlWebpackPlugin({template: path.join(src, "index.html"), filename: "index.html"})],
        optimization: production ? {splitChunks: {chunks: "all"}, minimize: false} : undefined,
        resolve: {
            extensions: [".js", ".jsx"],
            alias: {
                APIConfig: path.join(__dirname, `src/js/config/${process.env.NODE_ENV || (production ? "release" : "glytoucan")}.js`)
            }
        }
    };
};
