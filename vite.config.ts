import { defineConfig } from "vite";
import { resolve } from "path";
import { cpSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "/",
  define: {
    "process.env": {},
    global: "globalThis",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rolldownOptions: {
      input: {
        "service-worker/index": resolve(__dirname, "src/service-worker/index.ts"),
        "content/index": resolve(__dirname, "src/content/index.ts"),
        "options/options": resolve(__dirname, "src/options/options.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        manualChunks() {
          return undefined;
        },
      },
    },
  },
  plugins: [
    nodePolyfills({
      include: ["crypto", "stream", "buffer", "events", "http", "vm", "process"],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    {
      name: "copy-extension-files",
      writeBundle() {
        // The extension reports the npm package version; manifest.json carries no version of its own.
        const manifest = JSON.parse(readFileSync(resolve(__dirname, "manifest.json"), "utf8"));
        const { version } = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8"));
        writeFileSync(
          resolve(__dirname, "dist/manifest.json"),
          `${JSON.stringify({ ...manifest, version }, null, 2)}\n`
        );

        cpSync(
          resolve(__dirname, "src/service-worker-loader.js"),
          resolve(__dirname, "dist/service-worker-loader.js")
        );

        const iconsDir = resolve(__dirname, "dist/icons");
        if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });
        for (const size of [16, 48, 128]) {
          const src = resolve(__dirname, `icons/icon-${size}.png`);
          if (existsSync(src)) {
            cpSync(src, resolve(iconsDir, `icon-${size}.png`));
          }
        }

        const srcOptions = resolve(__dirname, "dist/src/options/options.html");
        const destOptions = resolve(__dirname, "dist/options/options.html");
        if (existsSync(srcOptions)) {
          cpSync(srcOptions, destOptions);
        }

        rmSync(resolve(__dirname, "dist/src"), { recursive: true, force: true });
      },
    },
  ],
});
