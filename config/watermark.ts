/**
 * 统一的水印配置
 * 为所有图片上传提供一致的水印设置
 */
export const watermarkConfig = {
    // 水印 SVG 配置
    svg: {
        width: 200,
        height: 200,
        viewBox: '0 0 200 200'
    },

    // 水印文字配置
    text: {
        content: 'OtoAme',
        fontSize: 24,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        fill: 'rgba(255, 255, 255, 0.12)',
        rotation: -45
    },

    // Sharp 复合配置
    composite: {
        tile: true,
        blend: 'over' as const
    }
} as const

/**
 * 生成水印 SVG
 */
export const generateWatermarkSVG = (): string => {
    const { svg, text } = watermarkConfig
    const centerX = svg.width / 2
    const centerY = svg.height / 2

    return `
    <svg width="${svg.width}" height="${svg.height}" viewBox="${svg.viewBox}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
        fill="${text.fill}" font-size="${text.fontSize}" font-family="${text.fontFamily}" font-weight="${text.fontWeight}"
        transform="rotate(${text.rotation}, ${centerX}, ${centerY})">${text.content}</text>
    </svg>
  `
}
