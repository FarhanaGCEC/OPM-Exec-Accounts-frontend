import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';

const UploadImages = () => {
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleRemoveFile = (index: number) => {
    setUploadedFiles((currentFiles) =>
      currentFiles.filter((_, i) => i !== index)
    );
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setUploadedFiles((prevFiles) => [
      ...prevFiles,
      ...acceptedFiles.map((file) =>
        Object.assign(file, { preview: URL.createObjectURL(file) })
      ),
    ]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    //@ts-ignore
    accept: 'image/*',
    multiple: true,
  });

  const thumbs = uploadedFiles.map((file, index) => (
    <Card key={file.name} className="flex gap-4 items-center p-4 mb-4">
      <img
        src={file.preview}
        alt={file.name}
        className="object-cover w-16 h-16 rounded"
      />
      <div className="flex flex-col">
        <span className="text-sm font-medium">{file.name}</span>
        <Button
          variant="destructive"
          size="sm"
          className="mt-2"
          onClick={() => handleRemoveFile(index)}
        >
          Remove
        </Button>
      </div>
    </Card>
  ));

  const handleUpload = () => {
    setIsDialogOpen(true);
  };

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-semibold">Upload Images</h2>
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-6 text-center ${
          isDragActive ? 'bg-blue-50 border-blue-500' : 'border-gray-300'
        }`}
      >
        <input {...getInputProps()} />
        {isDragActive ? (
          <p className="text-blue-500">Drop the files here...</p>
        ) : (
          <p className="text-gray-500">
            Drag & drop some images here, or click to select files
          </p>
        )}
      </div>
      <div className="space-y-4">{thumbs}</div>
      {uploadedFiles.length > 0 && (
        <Button onClick={handleUpload} className="w-full">
          Upload
        </Button>
      )}
    </div>
  );
};

export default UploadImages;
