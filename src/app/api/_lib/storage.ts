import { Storage } from '@google-cloud/storage'
import sharp from 'sharp'
import type { Sharp } from 'sharp'

type UploadToPublicBucketArgs = {
  buffer: Buffer
  filename: string
  contentType?: string
}

type UploadBufferToPublicBucketArgs = UploadToPublicBucketArgs & {
  cacheControl?: string
}

const storage = new Storage()

const getPublicBucketName = () => process.env.PUBLIC_BUCKET_NAME?.trim()

export const getPublicBucketUrl = () => {
  const name = getPublicBucketName()
  return name ? `https://storage.googleapis.com/${name}` : undefined
}

export class PublicBucketNotConfiguredError extends Error {
  constructor() {
    super('Public bucket is not configured')
  }
}

export const uploadToPublicBucket = async ({ buffer, filename, contentType }: UploadToPublicBucketArgs) => {
  const bucketName = getPublicBucketName()
  const publicBucketUrl = getPublicBucketUrl()

  if (!bucketName || !publicBucketUrl) {
    throw new PublicBucketNotConfiguredError()
  }

  const publicBucket = storage.bucket(bucketName)
  const cloudFile = publicBucket.file(filename)

  const sharpFactory = sharp as unknown as (input: Buffer) => Sharp
  const transformer: Sharp = sharpFactory(buffer)

  const transformed: Buffer = await transformer
    .rotate()
    .resize(360, 360, {
      withoutEnlargement: true,
      position: sharp.strategy.entropy,
    })
    .jpeg({
      progressive: true,
      chromaSubsampling: '4:4:4',
      trellisQuantisation: true,
      optimiseScans: true,
      optimiseCoding: true,
    })
    .toBuffer()

  await new Promise<void>((resolve, reject) => {
    const stream = cloudFile.createWriteStream({
      metadata: {
        contentType: contentType ?? 'image/jpeg',
        cacheControl: 'public, max-age=31536000',
      },
      resumable: false,
    })
    stream.on('error', reject)
    stream.on('finish', resolve)
    stream.end(transformed)
  })

  return `${publicBucketUrl}/${filename}`
}

export const uploadBufferToPublicBucket = async ({
  buffer,
  filename,
  contentType,
  cacheControl,
}: UploadBufferToPublicBucketArgs) => {
  const bucketName = getPublicBucketName()
  const publicBucketUrl = getPublicBucketUrl()

  if (!bucketName || !publicBucketUrl) {
    throw new PublicBucketNotConfiguredError()
  }

  const publicBucket = storage.bucket(bucketName)
  const cloudFile = publicBucket.file(filename)

  await new Promise<void>((resolve, reject) => {
    const stream = cloudFile.createWriteStream({
      metadata: {
        contentType: contentType ?? 'application/octet-stream',
        cacheControl: cacheControl ?? 'public, max-age=31536000, immutable',
      },
      resumable: false,
    })
    stream.on('error', reject)
    stream.on('finish', resolve)
    stream.end(buffer)
  })

  return `${publicBucketUrl}/${filename}`
}
