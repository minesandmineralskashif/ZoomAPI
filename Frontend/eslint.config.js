// eslint.config.js

const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: ["dist/*"],
    plugins: {
      import: require("eslint-plugin-import"),
    },
    rules: {
      // Optional: Silence unresolved warning if you trust expo packages
      "import/no-unresolved": "off",
    },
    settings: {
      "import/resolver": {
        node: {
          extensions: [".js", ".jsx", ".ts", ".tsx"],
        },
      },
    },
  },
]);
