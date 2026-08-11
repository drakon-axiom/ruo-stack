import type { FastifyInstance } from 'fastify';
import { MAX_IMPORT_BYTES } from '@ruostack/shared';
import { z } from 'zod';
import { getClients } from '../clients.ts';
import { requireAdmin } from '../middleware/guards.ts';
import { BadRequest } from '../errors.ts';
import { buildPreview, commitImport, previewDigest } from '../services/catalog-import.ts';

/**
 * CSV catalog import. Two phases: preview classifies and writes nothing, commit
 * re-computes the same classification against fresh state and writes only if it
 * still matches the digest the operator approved.
 *
 * Both routes require catalog WRITE even though preview is read-only — it is
 * step one of a write flow, so the UI has a single permission check and a
 * view-only role never lands on a half-usable screen.
 *
 * The CSV arrives as text in a JSON body (same shape as the logo upload in
 * brand-branding.ts) rather than as multipart: it keeps the API dependency-free
 * and the file is small and admin-authenticated. The global 1 MB body limit is
 * raised per-route because JSON-escaping a 2 MB CSV can approach 4 MB.
 */
const BODY_LIMIT = 5_242_880;

const PreviewSchema = z.object({
  csv: z.string(),
  filename: z.string().max(200).optional(),
});

const CommitSchema = PreviewSchema.extend({
  digest: z.string().min(1),
});

export async function adminCatalogImportRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  app.post(
    '/api/admin/catalog/import/preview',
    { preHandler: requireAdmin('catalog', 'write'), bodyLimit: BODY_LIMIT },
    async (req) => {
      const body = PreviewSchema.parse(req.body);
      assertSize(body.csv);
      return buildPreview(prisma, body.csv);
    },
  );

  app.post(
    '/api/admin/catalog/import/commit',
    { preHandler: requireAdmin('catalog', 'write'), bodyLimit: BODY_LIMIT },
    async (req, reply) => {
      const body = CommitSchema.parse(req.body);
      assertSize(body.csv);

      // Never trust the preview. Re-classify from the raw file against current
      // state; if anything moved, hand the fresh preview back and make the
      // operator look again rather than overwriting someone else's edit.
      const fresh = await buildPreview(prisma, body.csv);
      if (previewDigest(fresh.rows) !== body.digest) {
        return reply.code(409).send({
          error: 'preview_stale',
          message: 'The catalog changed while this import was being reviewed. Check the updated preview and import again.',
          preview: fresh,
        });
      }

      return commitImport(prisma, fresh.rows, {
        adminUserId: req.admin!.adminUserId,
        ip: req.ip,
        filename: body.filename,
      });
    },
  );
}

function assertSize(csv: string): void {
  if (Buffer.byteLength(csv, 'utf8') > MAX_IMPORT_BYTES) {
    throw BadRequest('too_large', `That file is larger than ${Math.floor(MAX_IMPORT_BYTES / 1_000_000)} MB. Split it and upload the parts.`);
  }
  if (csv.trim() === '') {
    throw BadRequest('empty_file', 'That file is empty. Start from the template and add one line per product.');
  }
}
