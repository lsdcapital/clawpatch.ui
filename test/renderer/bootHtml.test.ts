import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve(__dirname, "../../src/renderer/index.html"), "utf8");

describe("renderer boot document", () => {
  it("sets the initial background before the React bundle loads", () => {
    expect(html).toContain('<meta name="theme-color" content="#f6f7f8"');
    expect(html).toContain('<meta name="theme-color" content="#111318"');
    expect(html.indexOf("document.documentElement.style.backgroundColor")).toBeLessThan(
      html.indexOf('<script type="module" src="/src/main.tsx"></script>'),
    );
    expect(html).toContain("body {\n        background: #f6f7f8;");
    expect(html).toContain("background: #111318;");
    expect(html).toContain('<div id="root"><div id="boot-shell"></div></div>');
  });
});
