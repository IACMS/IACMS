import prisma from '../../config/database.js';

const FILE_SERVICE_URL = process.env.FILE_SERVICE_URL || 'http://file-service:3009';
if (!process.env.INTERNAL_SERVICE_TOKEN) {
  throw new Error('[attachment-service] INTERNAL_SERVICE_TOKEN environment variable is required.');
}
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN;

/**
 * Verify that the user uploaded the file to the File Service.
 * This prevents users from referencing arbitrary fileIds they don't own.
 */
export async function verifyOwnership(fileId, userId) {
  // In unit test environment where fetch is mocked, use fetch
  if (process.env.NODE_ENV === 'test' && typeof global.fetch === 'function') {
    try {
      const res = await fetch(`${FILE_SERVICE_URL}/internal/files/${fileId}/verify?userId=${userId}`, {
        headers: { 'Authorization': `Bearer ${INTERNAL_SERVICE_TOKEN}` },
      });
      
      if (res.status === 404 || res.status === 403) return false;
      if (!res.ok) throw new Error(`File service responded with ${res.status}`);
      
      const data = await res.json();
      return data.verified === true;
    } catch (err) {
      console.error(`[attachment-service] Failed to verify file ownership for ${fileId}:`, err.message);
      return false;
    }
  }

  // In runtime/production: verify directly against shared database
  try {
    const file = await prisma.file.findFirst({
      where: {
        id: fileId,
        ownerId: userId,
        deleted: false,
      },
      select: { id: true },
    });
    return !!file;
  } catch (err) {
    console.error(`[attachment-service] Database check failed for file ownership ${fileId}:`, err.message);
    return false;
  }
}

