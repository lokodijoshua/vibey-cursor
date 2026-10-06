figma.showUI(__html__, { width: 320, height: 220 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'import') {
    const node = JSON.parse(msg.json);
    await buildNode(node.data || node);
    figma.notify('Imported into Figma ✓');
  }
};

async function buildNode(node, parent = figma.currentPage, offsetX = 0, offsetY = 0) {
  const frame = figma.createFrame();
  frame.name = node.tag;
  frame.x = offsetX;
  frame.y = offsetY;

  const width = parseFloat(node.styles?.width) || 200;
  const height = parseFloat(node.styles?.height) || 80;
  frame.resize(Math.max(width, 10), Math.max(height, 10));

  const bg = parseColor(node.styles?.backgroundColor);
  if (bg) frame.fills = [{ type: 'SOLID', color: bg }];

  const radius = parseFloat(node.styles?.borderRadius);
  if (radius) frame.cornerRadius = radius;

  parent.appendChild ? parent.appendChild(frame) : figma.currentPage.appendChild(frame);

  if (node.text) {
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    const textNode = figma.createText();
    textNode.characters = node.text;
    textNode.fontSize = parseFloat(node.styles?.fontSize) || 14;
    const color = parseColor(node.styles?.color);
    if (color) textNode.fills = [{ type: 'SOLID', color }];
    frame.appendChild(textNode);
  }

  let childY = 10;
  for (const child of node.children || []) {
    await buildNode(child, frame, 10, childY);
    childY += 90;
  }

  figma.viewport.scrollAndZoomIntoView([frame]);
  return frame;
}

function parseColor(rgbString) {
  if (!rgbString) return null;
  const match = rgbString.match(/\d+(\.\d+)?/g);
  if (!match) return null;
  const [r, g, b] = match;
  return { r: r / 255, g: g / 255, b: b / 255 };
}