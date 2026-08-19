import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

async function generateIcons() {
  const sourceImage = path.join(process.cwd(), 'public', 'icon-512.svg');
  
  if (!fs.existsSync(sourceImage)) {
    throw new Error(`Source image not found: ${sourceImage}`);
  }

  const svgBuffer = fs.readFileSync(sourceImage);

  console.log('Generating pristine PNG v3 icons using sharp...');

  // 192x192 v3
  await sharp(svgBuffer)
    .resize(192, 192, {
      fit: "cover",
      position: "centre"
    })
    .png()
    .toFile(path.join(process.cwd(), 'public', 'icon-192-v3.png'));

  // 512x512 v3
  await sharp(svgBuffer)
    .resize(512, 512, {
      fit: "cover",
      position: "centre"
    })
    .png()
    .toFile(path.join(process.cwd(), 'public', 'icon-512-v3.png'));

  console.log('Icons v3 generated successfully!');
}

generateIcons().catch((err) => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
