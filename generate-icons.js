import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

async function generateIcons() {
  const svgPath = path.join(process.cwd(), 'public', 'icon-512.svg');
  const svgBuffer = fs.readFileSync(svgPath);

  console.log('Generating pristine PNG icons using sharp...');

  // 192x192
  await sharp(svgBuffer)
    .resize(192, 192)
    .png({ compressionLevel: 9, adaptiveFiltering: true, force: true })
    .toFile(path.join(process.cwd(), 'public', 'icon-192-v2.png'));

  await sharp(svgBuffer)
    .resize(192, 192)
    .png({ compressionLevel: 9, adaptiveFiltering: true, force: true })
    .toFile(path.join(process.cwd(), 'public', 'icon-192.png'));

  // 512x512
  await sharp(svgBuffer)
    .resize(512, 512)
    .png({ compressionLevel: 9, adaptiveFiltering: true, force: true })
    .toFile(path.join(process.cwd(), 'public', 'icon-512-v2.png'));

  await sharp(svgBuffer)
    .resize(512, 512)
    .png({ compressionLevel: 9, adaptiveFiltering: true, force: true })
    .toFile(path.join(process.cwd(), 'public', 'icon-512.png'));

  // Apple touch icon & Favicon
  await sharp(svgBuffer)
    .resize(180, 180)
    .png({ compressionLevel: 9, adaptiveFiltering: true, force: true })
    .toFile(path.join(process.cwd(), 'public', 'apple-touch-icon.png'));

  await sharp(svgBuffer)
    .resize(32, 32)
    .png({ compressionLevel: 9, adaptiveFiltering: true, force: true })
    .toFile(path.join(process.cwd(), 'public', 'favicon.png'));

  console.log('Icons generated successfully!');
}

generateIcons().catch((err) => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
