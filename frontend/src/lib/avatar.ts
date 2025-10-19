const region = import.meta.env.VITE_AWS_REGION;
const bucket = import.meta.env.VITE_AVATAR_BUCKET;

export const buildAvatarUrl = (key?: string | null) => {
  if (!key || !bucket || !region) return undefined;
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
};
