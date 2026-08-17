import sharp from "sharp";
import path from "path";
import fs from "fs";

const SOURCE_IMAGE = path.join(process.cwd(), "src/assets/images/icon_512_1786968229874.jpg");
const PUBLIC_DIR = path.join(process.cwd(), "public");

const ICONS_CONFIG = [
  {
    name: "icon-192-v2.png",
    width: 192,
    height: 192,
  },
  {
    name: "icon-512-v2.png",
    width: 512,
    height: 512,
  },
  {
    name: "icon-maskable-512-v2.png",
    width: 512,
    height: 512,
    // Maskable icons look better if we slightly inset them to ensure key elements aren't cut off by safe area,
    // but since our source has generous margins and a dark background, we can output directly.
  },
  {
    name: "apple-touch-icon-v2.png",
    width: 180,
    height: 180,
  }
];

async function generate() {
  try {
    if (!fs.existsSync(SOURCE_IMAGE)) {
      throw new Error(`Source image not found: ${SOURCE_IMAGE}`);
    }

    console.log(`[PWA Icon Generator] Using source image: ${SOURCE_IMAGE}`);
    
    for (const icon of ICONS_CONFIG) {
      const outputPath = path.join(PUBLIC_DIR, icon.name);
      console.log(`[PWA Icon Generator] Generating ${icon.name} (${icon.width}x${icon.height})...`);
      
      // Perform resize and convert to png using sharp
      await sharp(SOURCE_IMAGE)
        .resize(icon.width, icon.height, {
          fit: 'contain',
          background: { r: 15, g: 23, b: 42, alpha: 1 } // Matching background_color #0f172a
        })
        .png()
        .toFile(outputPath);

      // Verify the generated file
      const metadata = await sharp(outputPath).metadata();
      if (metadata.format !== 'png') {
        throw new Error(`Generated file ${icon.name} is not a valid PNG! Format: ${metadata.format}`);
      }
      if (metadata.width !== icon.width || metadata.height !== icon.height) {
        throw new Error(`Generated file ${icon.name} has incorrect dimensions: ${metadata.width}x${metadata.height}. Expected: ${icon.width}x${icon.height}`);
      }

      // Check file size
      const stats = fs.statSync(outputPath);
      if (stats.size === 0) {
        throw new Error(`Generated file ${icon.name} is empty!`);
      }

      console.log(`[PWA Icon Generator] Verified ${icon.name} - Format: ${metadata.format}, Dimensions: ${metadata.width}x${metadata.height}, Size: ${stats.size} bytes`);
    }

    console.log("\n[PWA Icon Generator] SUCCESS: All icons generated and verified successfully!");
  } catch (error) {
    console.error("\n[PWA Icon Generator] ERROR:", error.message);
    process.exit(1);
  }
}

generate();
