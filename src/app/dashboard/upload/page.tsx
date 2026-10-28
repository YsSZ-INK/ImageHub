import { requireUser } from "@/lib/session";
import { UploadDropzone } from "@/components/upload-dropzone";

export default async function UploadPage() {
  await requireUser();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">上传图片</h1>
      <UploadDropzone />
    </div>
  );
}
