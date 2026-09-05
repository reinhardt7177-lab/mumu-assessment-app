import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  resolve: { alias: { "next/link": fileURLToPath(new URL("./link.jsx", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 4174, strictPort: true },
});
