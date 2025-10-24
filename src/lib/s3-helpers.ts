import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({});

const USER_UPLOADS_BUCKET = process.env.USER_UPLOADS_BUCKET!;

/**
 * Generate a presigned PUT URL for uploading a file to S3
 */
export const generatePresignedPutUrl = async (
  key: string,
  contentType: string,
  expiresIn: number = 900 // 15 minutes default
): Promise<string> => {
  const command = new PutObjectCommand({
    Bucket: USER_UPLOADS_BUCKET,
    Key: key,
    ContentType: contentType
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
};

/**
 * Generate a presigned GET URL for downloading/viewing a file from S3
 */
export const generatePresignedGetUrl = async (
  key: string,
  expiresIn: number = 7 * 24 * 60 * 60 // 7 days default
): Promise<string> => {
  const command = new GetObjectCommand({
    Bucket: USER_UPLOADS_BUCKET,
    Key: key
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
};

/**
 * Delete a file from S3
 */
export const deleteFileFromS3 = async (key: string): Promise<void> => {
  const command = new DeleteObjectCommand({
    Bucket: USER_UPLOADS_BUCKET,
    Key: key
  });

  await s3Client.send(command);
};

/**
 * Delete multiple files from S3
 */
export const deleteFilesFromS3 = async (keys: string[]): Promise<void> => {
  await Promise.all(keys.map(key => deleteFileFromS3(key)));
};
