import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: ["node_modules/**"]
  },
  js.configs.recommended,
  {
    // Node.js (CommonJS) files: node_helper + server-side helpers + scripts
    files: ["node_helper.js", "MaSocket.js", "MaState.js", "scripts/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node
      }
    }
  },
  {
    // Browser frontend rendered inside MagicMirror
    files: ["MMM-MusicAssistant.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser
      }
    }
  }
]);
