interface AnimatedImagePlaceholderProps {
  aspectRatio: 'portrait' | 'landscape' | 'square';
}

export function AnimatedImagePlaceholder({ aspectRatio }: AnimatedImagePlaceholderProps) {
  const dimensions = {
    portrait: { width: 256, height: 384 },   // 2:3 ratio
    landscape: { width: 384, height: 256 },  // 3:2 ratio
    square: { width: 320, height: 320 }      // 1:1 ratio
  };

  const { width, height } = dimensions[aspectRatio];

  return (
    <div
      className="image-placeholder rounded-lg"
      style={{ width: `${width}px`, height: `${height}px` }}
      aria-label="Generating image..."
    />
  );
}
