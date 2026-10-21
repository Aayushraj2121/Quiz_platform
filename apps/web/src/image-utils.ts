/**
 * Automatically resize and compress image to modern WebP format
 * to drastically reduce download latency on participant devices.
 */
export async function optimizeImageForWeb(file: File, maxDimension = 1280, quality = 0.82): Promise<File> {
  // Only compress raster images; skip video, gifs (to preserve animation), or SVGs
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return file;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.onload = () => {
        let { width, height } = img;

        // If image is larger than maxDimension, downscale proportionally
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(file);

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= file.size) {
              // If compression didn't save space, keep original
              return resolve(file);
            }
            const cleanName = file.name.replace(/\.[^/.]+$/, '') + '.webp';
            const optimizedFile = new File([blob], cleanName, {
              type: 'image/webp',
              lastModified: Date.now()
            });
            resolve(optimizedFile);
          },
          'image/webp',
          quality
        );
      };

      img.onerror = () => resolve(file);
      img.src = e.target?.result as string;
    };

    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}
