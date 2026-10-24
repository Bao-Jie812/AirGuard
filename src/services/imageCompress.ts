/**
 * 浏览器端图片压缩：File → 小尺寸 JPEG dataURL。
 *
 * 用途：人工拍照留档的证据卡展示与 MQTT 多端同步。
 * 公共 Broker（broker.emqx.io）对单条报文大小有限制，
 * 原图（手机照片常达数 MB）不能直接塞进 MQTT 消息，
 * 统一压缩到最长边 640px、JPEG 0.72（约 30–80KB base64）。
 */

const MAX_DIMENSION = 640
const JPEG_QUALITY = 0.72

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片解码失败'))
    image.src = src
  })
}

/**
 * 压缩图片为 JPEG dataURL。
 * 部分格式（如桌面浏览器上的 HEIC）无法解码时会抛错，
 * 调用方应降级为「仅保存元数据」，不伪造图片。
 */
export async function compressImageToDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await loadImage(objectUrl)
    const scale = Math.min(
      1,
      MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
    )
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D 上下文不可用')
    ctx.drawImage(image, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
