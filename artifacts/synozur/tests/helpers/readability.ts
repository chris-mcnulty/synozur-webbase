import { expect, type Locator } from "@playwright/test";

/** Resolve transparent ancestor backgrounds, not just the prose div's
 * transparent background. Canvas converts modern CSS colors (including oklch)
 * into sRGB before calculating WCAG relative luminance. */
export async function contrastSamples(locator: Locator) {
  return locator.evaluateAll((elements) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (color: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      return [data[0], data[1], data[2], data[3] / 255];
    };
    const over = (front: number[], back: number[]) =>
      [0, 1, 2].map((i) => front[i] * front[3] + back[i] * (1 - front[3])).concat(1);
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    return elements.map((element) => {
      const ancestors: Element[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
      let background = [255, 255, 255, 1];
      for (const ancestor of ancestors) {
        const style = getComputedStyle(ancestor);
        // These fixture surfaces are solid. Fail rather than pretend a gradient
        // or opacity layer has been measured accurately.
        if (style.backgroundImage !== "none" || style.opacity !== "1") {
          throw new Error(`Unsupported contrast surface: ${ancestor.tagName}`);
        }
        background = over(rgba(style.backgroundColor), background);
      }
      const style = getComputedStyle(element);
      const foreground = over(rgba(style.color), background);
      const a = luminance(foreground), b = luminance(background);
      return {
        text: element.textContent,
        color: style.color,
        background,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      };
    });
  });
}

export async function expectReadable(locator: Locator) {
  const samples = await contrastSamples(locator);
  expect(samples.length).toBeGreaterThan(0);
  for (const sample of samples) {
    expect(sample.ratio, JSON.stringify(sample)).toBeGreaterThanOrEqual(4.5);
  }
}
