-- AlterEnum
ALTER TYPE "auth_audience" ADD VALUE 'customer';

-- CreateEnum
CREATE TYPE "customer_token_purpose" AS ENUM ('email_verification');

-- CreateTable
CREATE TABLE "customer" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_consent" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "policy_version_id" UUID NOT NULL,
    "consented_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_token" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "purpose" "customer_token_purpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_email_key" ON "customer"("email");

-- CreateIndex
CREATE INDEX "customer_consent_customer_id_idx" ON "customer_consent"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_token_token_hash_key" ON "customer_token"("token_hash");

-- CreateIndex
CREATE INDEX "customer_token_customer_id_purpose_idx" ON "customer_token"("customer_id", "purpose");

-- AddForeignKey
ALTER TABLE "customer_consent" ADD CONSTRAINT "customer_consent_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consent" ADD CONSTRAINT "customer_consent_policy_version_id_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "content_page_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_token" ADD CONSTRAINT "customer_token_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Lời đồng ý là bằng chứng khách đã chấp nhận đúng phiên bản chính sách đó: chỉ thêm mới, không sửa, không xóa.
CREATE FUNCTION "customer_consent_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'customer_consent chỉ cho phép thêm mới';
END;
$$;

CREATE TRIGGER "customer_consent_no_update_delete" BEFORE UPDATE OR DELETE ON "customer_consent"
  FOR EACH ROW EXECUTE FUNCTION "customer_consent_append_only"();

CREATE TRIGGER "customer_consent_no_truncate" BEFORE TRUNCATE ON "customer_consent"
  FOR EACH STATEMENT EXECUTE FUNCTION "customer_consent_append_only"();
