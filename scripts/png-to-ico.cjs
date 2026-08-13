const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodeRgbaPng(filePath) {
  const png = fs.readFileSync(filePath);
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("PNG 파일이 아닙니다.");

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    }
    offset += length + 12;
  }

  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error("8비트 RGBA 비인터레이스 PNG만 지원합니다.");
  }

  const bytesPerPixel = 4;
  const rowLength = width * bytesPerPixel;
  const filtered = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * bytesPerPixel);

  for (let y = 0; y < height; y += 1) {
    const filter = filtered[y * (rowLength + 1)];
    for (let x = 0; x < rowLength; x += 1) {
      const source = filtered[y * (rowLength + 1) + x + 1];
      const outputIndex = y * rowLength + x;
      const left = x >= bytesPerPixel ? pixels[outputIndex - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[outputIndex - rowLength] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? pixels[outputIndex - rowLength - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      else if (filter !== 0) throw new Error(`지원하지 않는 PNG 필터입니다: ${filter}`);
      pixels[outputIndex] = (source + predictor) & 255;
    }
  }

  return { width, height, pixels };
}

function resizeRgba(source, targetWidth, targetHeight) {
  const output = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceTop = targetY * source.height / targetHeight;
    const sourceBottom = (targetY + 1) * source.height / targetHeight;
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceLeft = targetX * source.width / targetWidth;
      const sourceRight = (targetX + 1) * source.width / targetWidth;
      let alphaSum = 0;
      let redSum = 0;
      let greenSum = 0;
      let blueSum = 0;
      let areaSum = 0;

      for (let sourceY = Math.floor(sourceTop); sourceY < Math.ceil(sourceBottom); sourceY += 1) {
        const verticalWeight = Math.min(sourceBottom, sourceY + 1) - Math.max(sourceTop, sourceY);
        for (let sourceX = Math.floor(sourceLeft); sourceX < Math.ceil(sourceRight); sourceX += 1) {
          const horizontalWeight = Math.min(sourceRight, sourceX + 1) - Math.max(sourceLeft, sourceX);
          const weight = horizontalWeight * verticalWeight;
          const sourceIndex = (sourceY * source.width + sourceX) * 4;
          const alpha = source.pixels[sourceIndex + 3] / 255;
          areaSum += weight;
          alphaSum += alpha * weight;
          redSum += source.pixels[sourceIndex] * alpha * weight;
          greenSum += source.pixels[sourceIndex + 1] * alpha * weight;
          blueSum += source.pixels[sourceIndex + 2] * alpha * weight;
        }
      }

      const outputIndex = (targetY * targetWidth + targetX) * 4;
      if (alphaSum > 0) {
        output[outputIndex] = Math.round(redSum / alphaSum);
        output[outputIndex + 1] = Math.round(greenSum / alphaSum);
        output[outputIndex + 2] = Math.round(blueSum / alphaSum);
      }
      output[outputIndex + 3] = Math.round(alphaSum / areaSum * 255);
    }
  }
  return { width: targetWidth, height: targetHeight, pixels: output };
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return chunk;
}

function encodeRgbaPng(image) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;

  const rowLength = image.width * 4;
  const raw = Buffer.alloc((rowLength + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    raw[y * (rowLength + 1)] = 0;
    image.pixels.copy(raw, y * (rowLength + 1) + 1, y * rowLength, (y + 1) * rowLength);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function encodeIco(images) {
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let imageOffset = directory.length;

  images.forEach(({ size, png }, index) => {
    const entryOffset = 6 + index * 16;
    directory[entryOffset] = size === 256 ? 0 : size;
    directory[entryOffset + 1] = size === 256 ? 0 : size;
    directory[entryOffset + 2] = 0;
    directory[entryOffset + 3] = 0;
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(png.length, entryOffset + 8);
    directory.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += png.length;
  });

  return Buffer.concat([directory, ...images.map((image) => image.png)]);
}

const inputPath = path.resolve(process.argv[2] || "build/AAA_icon.png");
const outputPath = path.resolve(process.argv[3] || "build/AAA_icon.ico");
const source = decodeRgbaPng(inputPath);
if (source.width !== source.height) throw new Error("아이콘 원본은 정사각형이어야 합니다.");
if (source.width < 256) throw new Error("아이콘 원본은 최소 256×256이어야 합니다.");

const images = ICON_SIZES.map((size) => ({ size, png: encodeRgbaPng(resizeRgba(source, size, size)) }));
fs.writeFileSync(outputPath, encodeIco(images));
console.log(`${path.basename(outputPath)}: ${ICON_SIZES.join(", ")}px`);
