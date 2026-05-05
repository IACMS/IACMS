-- AlterTable
ALTER TABLE "workflow_steps" ADD COLUMN "requires_attachment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "case_attachments" ADD COLUMN "workflow_step_id" UUID;

-- AddForeignKey
ALTER TABLE "case_attachments" ADD CONSTRAINT "case_attachments_workflow_step_id_fkey" FOREIGN KEY ("workflow_step_id") REFERENCES "workflow_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "case_attachments_workflow_step_id_idx" ON "case_attachments"("workflow_step_id");
