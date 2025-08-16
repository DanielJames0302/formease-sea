import { CheckCircleFillIcon, DownloadIcon, PdfIcon } from './icons';
import { Button } from './ui/button';

interface PDFFilledResult {
  success: boolean;
  filledPdfUrl?: string;
  message: string;
  fields?: Record<string, string>;
}

interface PDFFillResultProps {
  result: PDFFilledResult;
}

export function PDFFillResult({ result }: PDFFillResultProps) {
  const handleDownload = async () => {
    if (!result.filledPdfUrl) return;
    
    try {
      const response = await fetch(result.filledPdfUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'filled-form.pdf';
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  const handleViewPdf = () => {
    if (result.filledPdfUrl) {
      window.open(result.filledPdfUrl, '_blank');
    }
  };

  return (
    <div className="border rounded-lg p-4 bg-background">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          {result.success ? (
            <CheckCircleFillIcon size={24} />
          ) : (
            <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center">
              <span className="text-red-600 text-sm font-bold">!</span>
            </div>
          )}
        </div>
        
        <div className="flex-1 space-y-3">
          <div>
            <h3 className="font-medium text-foreground">
              {result.success ? 'PDF Form Filled Successfully' : 'PDF Filling Failed'}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {result.message}
            </p>
          </div>

          {result.success && result.filledPdfUrl && (
            <div className="bg-muted rounded-md p-3">
              <div className="flex items-center gap-2 mb-3">
                <PdfIcon size={20} />
                <span className="font-medium text-sm">Filled PDF Ready</span>
              </div>
              
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleViewPdf}
                  className="flex items-center gap-2"
                >
                  <span>View PDF</span>
                </Button>
                
                <Button
                  size="sm"
                  onClick={handleDownload}
                  className="flex items-center gap-2"
                >
                  <DownloadIcon size={14} />
                  <span>Download</span>
                </Button>
              </div>
            </div>
          )}

          {result.fields && Object.keys(result.fields).length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                View filled fields ({Object.keys(result.fields).length})
              </summary>
              <div className="mt-2 bg-muted rounded p-2 max-h-32 overflow-y-auto">
                {Object.entries(result.fields).map(([fieldName, value]) => (
                  <div key={fieldName} className="flex gap-2 py-1 text-xs">
                    <span className="font-mono text-muted-foreground min-w-0 truncate">
                      {fieldName}:
                    </span>
                    <span className="min-w-0 truncate">{value}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
