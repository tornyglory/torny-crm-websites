// vitest.config.ts
import { defineConfig as defineConfig2, mergeConfig } from "file:///Users/nevrodda/Documents/torny/node_modules/.pnpm/vitest@2.1.9_@types+node@22.20.1_jsdom@25.0.1_terser@5.50.0/node_modules/vitest/dist/config.js";

// vite.config.ts
import { defineConfig } from "file:///Users/nevrodda/Documents/torny/node_modules/.pnpm/vite@6.4.3_@types+node@22.20.1_jiti@2.7.0_terser@5.50.0_yaml@2.9.0/node_modules/vite/dist/node/index.js";
import vue from "file:///Users/nevrodda/Documents/torny/node_modules/.pnpm/@vitejs+plugin-vue@5.2.4_vite@6.4.3_@types+node@22.20.1_jiti@2.7.0_terser@5.50.0_yaml@2.9.0___i6ywwqrusuwxkug4qluwzb6gdq/node_modules/@vitejs/plugin-vue/dist/index.mjs";
import { fileURLToPath, URL } from "node:url";
var __vite_injected_original_import_meta_url = "file:///Users/nevrodda/Documents/torny/apps/crm/vite.config.ts";
var vite_config_default = defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", __vite_injected_original_import_meta_url))
    }
  },
  server: {
    port: 5174
  }
});

// vitest.config.ts
var vitest_config_default = mergeConfig(
  vite_config_default,
  defineConfig2({
    test: {
      environment: "jsdom",
      globals: true,
      // Only pick up `*.test.ts(x)` files inside src/. The ad-hoc smoke
      // scripts in /tmp/ shouldn't run under CI.
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      setupFiles: ["./src/__tests__/setup.ts"]
    }
  })
);
export {
  vitest_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZXN0LmNvbmZpZy50cyIsICJ2aXRlLmNvbmZpZy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9Vc2Vycy9uZXZyb2RkYS9Eb2N1bWVudHMvdG9ybnkvYXBwcy9jcm1cIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy9uZXZyb2RkYS9Eb2N1bWVudHMvdG9ybnkvYXBwcy9jcm0vdml0ZXN0LmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvbmV2cm9kZGEvRG9jdW1lbnRzL3Rvcm55L2FwcHMvY3JtL3ZpdGVzdC5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcsIG1lcmdlQ29uZmlnIH0gZnJvbSAndml0ZXN0L2NvbmZpZydcbmltcG9ydCB2aXRlQ29uZmlnIGZyb20gJy4vdml0ZS5jb25maWcnXG5cbmV4cG9ydCBkZWZhdWx0IG1lcmdlQ29uZmlnKFxuICB2aXRlQ29uZmlnLFxuICBkZWZpbmVDb25maWcoe1xuICAgIHRlc3Q6IHtcbiAgICAgIGVudmlyb25tZW50OiAnanNkb20nLFxuICAgICAgZ2xvYmFsczogdHJ1ZSxcbiAgICAgIC8vIE9ubHkgcGljayB1cCBgKi50ZXN0LnRzKHgpYCBmaWxlcyBpbnNpZGUgc3JjLy4gVGhlIGFkLWhvYyBzbW9rZVxuICAgICAgLy8gc2NyaXB0cyBpbiAvdG1wLyBzaG91bGRuJ3QgcnVuIHVuZGVyIENJLlxuICAgICAgaW5jbHVkZTogWydzcmMvKiovKi50ZXN0LnRzJywgJ3NyYy8qKi8qLnRlc3QudHN4J10sXG4gICAgICBzZXR1cEZpbGVzOiBbJy4vc3JjL19fdGVzdHNfXy9zZXR1cC50cyddLFxuICAgIH0sXG4gIH0pLFxuKVxuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvbmV2cm9kZGEvRG9jdW1lbnRzL3Rvcm55L2FwcHMvY3JtXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvVXNlcnMvbmV2cm9kZGEvRG9jdW1lbnRzL3Rvcm55L2FwcHMvY3JtL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9Vc2Vycy9uZXZyb2RkYS9Eb2N1bWVudHMvdG9ybnkvYXBwcy9jcm0vdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHZ1ZSBmcm9tICdAdml0ZWpzL3BsdWdpbi12dWUnXG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoLCBVUkwgfSBmcm9tICdub2RlOnVybCdcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3Z1ZSgpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi9zcmMnLCBpbXBvcnQubWV0YS51cmwpKSxcbiAgICB9LFxuICB9LFxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiA1MTc0LFxuICB9LFxufSlcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBOFMsU0FBUyxnQkFBQUEsZUFBYyxtQkFBbUI7OztBQ0E5QyxTQUFTLG9CQUFvQjtBQUN2VSxPQUFPLFNBQVM7QUFDaEIsU0FBUyxlQUFlLFdBQVc7QUFGcUosSUFBTSwyQ0FBMkM7QUFJek8sSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLElBQUksQ0FBQztBQUFBLEVBQ2YsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxjQUFjLElBQUksSUFBSSxTQUFTLHdDQUFlLENBQUM7QUFBQSxJQUN0RDtBQUFBLEVBQ0Y7QUFBQSxFQUNBLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxFQUNSO0FBQ0YsQ0FBQzs7O0FEWEQsSUFBTyx3QkFBUTtBQUFBLEVBQ2I7QUFBQSxFQUNBQyxjQUFhO0FBQUEsSUFDWCxNQUFNO0FBQUEsTUFDSixhQUFhO0FBQUEsTUFDYixTQUFTO0FBQUE7QUFBQTtBQUFBLE1BR1QsU0FBUyxDQUFDLG9CQUFvQixtQkFBbUI7QUFBQSxNQUNqRCxZQUFZLENBQUMsMEJBQTBCO0FBQUEsSUFDekM7QUFBQSxFQUNGLENBQUM7QUFDSDsiLAogICJuYW1lcyI6IFsiZGVmaW5lQ29uZmlnIiwgImRlZmluZUNvbmZpZyJdCn0K
