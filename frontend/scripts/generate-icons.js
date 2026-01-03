const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = [192, 512];
const publicDir = path.join(__dirname, '..', 'public');

async function generateIcons() {
  for (const size of sizes) {
    const svgPath = path.join(publicDir, `icon-${size}.svg`);
    const pngPath = path.join(publicDir, `icon-${size}.png`);

    const svgBuffer = fs.readFileSync(svgPath);

    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(pngPath);

    console.log(`Generated: icon-${size}.png`);
  }

  // Generate apple-touch-icon (180x180)
  const svg512 = fs.readFileSync(path.join(publicDir, 'icon-512.svg'));
  await sharp(svg512)
    .resize(180, 180)
    .png()
    .toFile(path.join(publicDir, 'apple-touch-icon.png'));

  console.log('Generated: apple-touch-icon.png');
  console.log('Done!');
}

generateIcons().catch(console.error);
