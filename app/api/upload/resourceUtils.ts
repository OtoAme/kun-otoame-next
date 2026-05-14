import path from 'path'
import { createReadStream } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { blake3 } from '@noble/hashes/blake3'
import { bytesToHex } from '@noble/hashes/utils'

export const generateFileHash = async (filePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const hashInstance = blake3.create({})
    const fileStream = createReadStream(filePath)
    fileStream.on('data', (chunk) => {
      hashInstance.update(chunk)
    })
    fileStream.on('end', () => {
      const hashString = bytesToHex(hashInstance.digest())
      resolve(hashString)
    })
    fileStream.on('error', (err) => {
      reject(err)
    })
  })
}

export const calculateFileStreamHash = async (
  fileBuffer: Buffer,
  fileDir: string,
  uploadId: string,
  filename: string
) => {
  const uploadDir = path.posix.join(fileDir, uploadId)
  await mkdir(uploadDir, { recursive: true })
  const hashInstance = blake3.create({})

  hashInstance.update(fileBuffer)
  const fileHash = bytesToHex(hashInstance.digest())
  const finalFilePath = path.posix.join(uploadDir, filename)

  await writeFile(finalFilePath, fileBuffer)

  return { fileHash, finalFilePath, uploadDir }
}
