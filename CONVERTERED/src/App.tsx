import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  FileUp, 
  FileJson, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  Download, 
  Copy, 
  Trash2,
  FileText,
  Eye,
  Code,
  Settings2,
  ChevronDown,
  ChevronUp,
  Edit2 as EditIcon
} from 'lucide-react';
import { InlineMath, BlockMath } from 'react-katex';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { digitizePdfStream, type DigitizeOptions } from './services/gemini';
import { GraphVisualizer } from './components/GraphVisualizer';
import { QuestionEditor } from './components/QuestionEditor';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Helper component to render text with LaTeX
const FormattedText = ({ text, isJson = false }: { text: string; isJson?: boolean }) => {
  if (!text) return null;
  
  // If it's JSON, we might see double backslashes for LaTeX
  const processedText = isJson ? text.replace(/\\\\/g, '\\') : text;
  
  // Improved regex to handle various LaTeX delimiters
  const parts = processedText.split(/(\$\$.*?\$\$|\$.*?\$|\\\[.*?\\\]|\\\(.*?\\\))/gs);
  
  return (
    <span>
      {parts.map((part, i) => {
        if ((part.startsWith('$$') && part.endsWith('$$')) || (part.startsWith('\\[') && part.endsWith('\\]'))) {
          const math = part.startsWith('$$') ? part.slice(2, -2) : part.slice(2, -2);
          return <BlockMath key={i} math={math} />;
        } else if ((part.startsWith('$') && part.endsWith('$')) || (part.startsWith('\\(') && part.endsWith('\\)'))) {
          const math = part.startsWith('$') ? part.slice(1, -1) : part.slice(2, -2);
          return <InlineMath key={i} math={math} />;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
};

interface QuestionItemProps {
  question: any;
  index: number;
}

interface HistoryItem {
  id: string;
  fileName: string;
  timestamp: number;
  result: any;
  metadata?: any;
}

// Helper component to render a single question
const QuestionItem: React.FC<QuestionItemProps> = ({ question, index }) => {
  return (
    <div className="border-b border-gray-100 pb-6 last:border-0">
      <div className="flex gap-3 mb-4">
        <span className="flex-shrink-0 w-8 h-8 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center font-bold text-sm">
          {index}
        </span>
        <div className="flex-1">
          <div className="text-lg font-medium leading-relaxed mb-2 flex items-center gap-2">
            <FormattedText text={question.question} />
            {question.groupId && (
              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-600 text-[10px] font-bold rounded-md uppercase">
                Group: {question.groupId}
              </span>
            )}
          </div>
          
          {question.hasImage && (
            <div className="my-4 p-4 bg-amber-50/50 border border-amber-100/50 rounded-2xl flex flex-col items-center gap-4">
              {question.graph ? (
                <div className="w-full bg-white rounded-xl p-2 border border-gray-100/80 shadow-xs">
                  <GraphVisualizer graph={question.graph} />
                </div>
              ) : (
                <div className="w-full aspect-video bg-gray-200 rounded-xl flex items-center justify-center text-gray-400 border-2 border-dashed border-gray-300">
                  <Eye className="w-8 h-8 opacity-20" />
                  <span className="text-xs font-medium ml-2">Hình ảnh/Sơ đồ từ PDF</span>
                </div>
              )}
              {question.imageDescription && (
                <p className="text-xs text-amber-900 italic text-center px-4">
                  <b>Mô tả AI:</b> {question.imageDescription}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {question.type === 'mcq' && question.options && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 ml-11">
          {question.options.map((opt: string, optIdx: number) => (
            <div 
              key={optIdx} 
              className={cn(
                "p-3 rounded-xl border transition-all flex items-center gap-3",
                question.answer === String(optIdx) 
                  ? "bg-green-50 border-green-200 text-green-800" 
                  : "bg-gray-50 border-gray-100"
              )}
            >
              <span className="w-6 h-6 rounded-md bg-white border border-inherit flex items-center justify-center text-xs font-bold">
                {String.fromCharCode(65 + optIdx)}
              </span>
              <FormattedText text={opt} />
            </div>
          ))}
        </div>
      )}

      {question.type === 'truefalse' && question.statements && (
        <div className="space-y-3 ml-11">
          {question.statements.map((s: string, sIdx: number) => (
            <div key={sIdx} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
              <div className="flex-1 mr-4">
                <FormattedText text={s} />
              </div>
              <span className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold uppercase",
                question.answers?.[sIdx] === 'D' || question.answers?.[sIdx] === 'T' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
              )}>
                {question.answers?.[sIdx] === 'D' || question.answers?.[sIdx] === 'T' ? 'Đúng' : 'Sai'}
              </span>
            </div>
          ))}
        </div>
      )}

      {question.type === 'short' && (
        <div className="ml-11">
          <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100">
            <p className="text-xs text-indigo-400 uppercase font-bold mb-1">Đáp án:</p>
            <p className="font-medium text-indigo-900">
              <FormattedText text={question.answer} />
            </p>
          </div>
        </div>
      )}

      {question.type === 'matching' && question.left && (
        <div className="ml-11 space-y-2">
          {question.left.map((l: string, lIdx: number) => (
            <div key={lIdx} className="flex items-center gap-4">
              <div className="flex-1 p-3 bg-gray-50 rounded-xl border border-gray-100 text-sm">
                <FormattedText text={l} />
              </div>
              <div className="text-indigo-400">→</div>
              <div className="flex-1 p-3 bg-indigo-50 rounded-xl border border-indigo-100 text-sm font-medium">
                <FormattedText text={question.right?.[question.answers?.[lIdx]] || '...'} />
              </div>
            </div>
          ))}
        </div>
      )}
      
      {question.explanation && (
        <div className="mt-4 ml-11 p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs text-gray-500 italic">
          <b>Giải thích:</b> <FormattedText text={question.explanation} />
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [result, setResult] = useState<any>(null);
  const [rawText, setRawText] = useState<string>('');
  const [error, setError] = useState<{ message: string; code?: string; link?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'json' | 'preview' | 'raw' | 'editor'>('json');
  const [showSettings, setShowSettings] = useState(false);
  const [allowedTypes, setAllowedTypes] = useState<string[]>(['mcq', 'truefalse', 'short', 'matching']);
  const [customInstructions, setCustomInstructions] = useState('');
  const [groupSharedContext, setGroupSharedContext] = useState(true);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Load history from localStorage
  React.useEffect(() => {
    const savedHistory = localStorage.getItem('digitizer_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error('Failed to parse history', e);
      }
    }
  }, []);

  // Save history to localStorage
  const saveToHistory = (newItem: HistoryItem) => {
    const updatedHistory = [newItem, ...history].slice(0, 20); // Keep last 20 items
    setHistory(updatedHistory);
    localStorage.setItem('digitizer_history', JSON.stringify(updatedHistory));
  };

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedHistory = history.filter(item => item.id !== id);
    setHistory(updatedHistory);
    localStorage.setItem('digitizer_history', JSON.stringify(updatedHistory));
  };

  const loadFromHistory = (item: HistoryItem) => {
    setResult(item.result);
    setRawText(JSON.stringify(item.result, null, 2));
    setViewMode('preview');
    setShowHistory(false);
    // We don't have the original File object anymore, but we can mock the name
    setFile({ name: item.fileName, size: 0 } as any);
  };

  const questionTypes = [
    { id: 'mcq', label: 'Trắc nghiệm (MCQ)' },
    { id: 'truefalse', label: 'Đúng/Sai' },
    { id: 'short', label: 'Tự luận ngắn' },
    { id: 'matching', label: 'Nối đáp án' },
  ];

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      setError(null);
      setResult(null);
      setRawText('');
      setProgress(0);
      setStatusText('');
    } else {
      setError({ message: 'Vui lòng chọn file PDF hợp lệ.' });
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: false
  } as any);

  const processFile = async (selectedFile: File) => {
    setIsProcessing(true);
    setError(null);
    setResult(null);
    setRawText('');
    setProgress(5);
    setStatusText('Đang đọc file PDF...');

    // Progress simulation
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev < 30) return prev + 2;
        if (prev < 70) return prev + 1;
        if (prev < 90) return prev + 0.5;
        return prev;
      });
    }, 200);

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(selectedFile);
      const base64Data = await base64Promise;

      setProgress(35);
      setStatusText('Đang kết nối với AI...');

      let accumulatedText = '';
      const options: DigitizeOptions = {
        allowedTypes,
        customInstructions: customInstructions.trim() || undefined,
        groupSharedContext
      };
      
      const stream = digitizePdfStream(base64Data, selectedFile.type, options);
      
      setStatusText('AI đang phân tích và điền dữ liệu...');
      
      for await (const chunk of stream) {
        accumulatedText += chunk;
        setRawText(accumulatedText);
      }

      const finalData = JSON.parse(accumulatedText);
      setResult(finalData);
      
      // Add to history
      saveToHistory({
        id: crypto.randomUUID(),
        fileName: selectedFile.name,
        timestamp: Date.now(),
        result: finalData,
        metadata: finalData.metadata
      });

      clearInterval(progressInterval);
      setProgress(100);
      setStatusText('Hoàn tất!');
      setViewMode('editor');
    } catch (err: any) {
      clearInterval(progressInterval);
      console.error(err);
      
      let errorMessage = 'Đã có lỗi xảy ra trong quá trình xử lý.';
      let errorCode = err.code || err.status;
      let troubleshootingLink = 'https://ai.google.dev/gemini-api/docs/troubleshooting';

      if (err.message?.includes('API key')) {
        errorMessage = 'Lỗi xác thực: API Key không hợp lệ hoặc đã hết hạn.';
      } else if (err.message?.includes('quota')) {
        errorMessage = 'Lỗi giới hạn: Bạn đã hết hạn mức sử dụng API miễn phí.';
      } else if (err.message?.includes('safety')) {
        errorMessage = 'Lỗi nội dung: PDF chứa nội dung bị chặn bởi bộ lọc an toàn của AI.';
      }

      setError({
        message: errorMessage,
        code: errorCode,
        link: troubleshootingLink
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file?.name.replace('.pdf', '') || 'quiz'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setRawText('');
  };

  const toggleType = (typeId: string) => {
    setAllowedTypes(prev => 
      prev.includes(typeId) 
        ? prev.filter(t => t !== typeId) 
        : [...prev, typeId]
    );
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] text-[#111827] font-sans p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <header className="mb-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-2xl mb-4 shadow-lg shadow-indigo-200">
            <FileJson className="text-white w-8 h-8" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-2">Số hóa PDF sang JSON</h1>
          <p className="text-gray-500 text-lg">Chuyển đổi tài liệu trắc nghiệm PDF thành dữ liệu JSON cấu trúc chuẩn.</p>
          
          <div className="mt-6 flex justify-center gap-4">
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className={cn(
                "px-6 py-2.5 rounded-xl border transition-all flex items-center gap-2 text-sm font-semibold",
                showSettings ? "bg-indigo-50 border-indigo-200 text-indigo-600" : "bg-white border-gray-200 text-gray-600 hover:border-gray-300 shadow-sm"
              )}
            >
              <Settings2 className="w-4 h-4" />
              Cấu hình AI
              {showSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            <button 
              onClick={() => setShowHistory(!showHistory)}
              className={cn(
                "px-6 py-2.5 rounded-xl border transition-all flex items-center gap-2 text-sm font-semibold",
                showHistory ? "bg-indigo-50 border-indigo-200 text-indigo-600" : "bg-white border-gray-200 text-gray-600 hover:border-gray-300 shadow-sm"
              )}
            >
              <FileText className="w-4 h-4" />
              Lịch sử
              {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* History Panel */}
        {showHistory && (
          <div className="mb-8 bg-white p-6 rounded-3xl border border-indigo-100 shadow-sm animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-600" />
                Lịch sử số hóa gần đây
              </h3>
              {history.length > 0 && (
                <button 
                  onClick={() => {
                    if (confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử?')) {
                      setHistory([]);
                      localStorage.removeItem('digitizer_history');
                    }
                  }}
                  className="text-[10px] font-bold text-red-500 hover:text-red-600 uppercase tracking-wider transition-colors"
                >
                  Xóa tất cả
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="text-gray-400 text-sm italic py-4 text-center">Chưa có lịch sử số hóa.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {history.map((item) => (
                  <div 
                    key={item.id}
                    onClick={() => loadFromHistory(item)}
                    className="group p-4 bg-gray-50 hover:bg-indigo-50 border border-gray-100 hover:border-indigo-200 rounded-2xl transition-all cursor-pointer relative"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 overflow-hidden">
                        <p className="font-semibold text-gray-900 truncate text-sm" title={item.fileName}>
                          {item.fileName}
                        </p>
                        <p className="text-[10px] text-gray-400">
                          {new Date(item.timestamp).toLocaleString('vi-VN')}
                        </p>
                      </div>
                      <button 
                        onClick={(e) => deleteHistoryItem(item.id, e)}
                        className="p-1.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                        title="Xóa"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {item.metadata && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {item.metadata.subject && (
                          <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded text-[9px] font-bold uppercase">
                            {item.metadata.subject}
                          </span>
                        )}
                        {item.metadata.grade && (
                          <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-600 rounded text-[9px] font-bold uppercase">
                            Lớp {item.metadata.grade}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Settings Panel */}
        {showSettings && (
          <div className="mb-8 bg-white p-8 rounded-3xl border border-indigo-100 shadow-sm animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                  Loại câu hỏi cần lấy
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {questionTypes.map(type => (
                    <button
                      key={type.id}
                      onClick={() => toggleType(type.id)}
                      className={cn(
                        "p-3 rounded-xl border text-left transition-all flex items-center gap-3",
                        allowedTypes.includes(type.id) 
                          ? "bg-indigo-50 border-indigo-200 text-indigo-700" 
                          : "bg-gray-50 border-gray-100 text-gray-500 grayscale opacity-60"
                      )}
                    >
                      <div className={cn(
                        "w-5 h-5 rounded-md border flex items-center justify-center transition-colors",
                        allowedTypes.includes(type.id) ? "bg-indigo-600 border-indigo-600" : "bg-white border-gray-300"
                      )}>
                        {allowedTypes.includes(type.id) && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                      </div>
                      <span className="text-sm font-medium">{type.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-indigo-600" />
                  Yêu cầu đặc biệt cho AI
                </h3>
                <textarea
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="Ví dụ: 'Chỉ lấy các câu hỏi phần I', 'Bỏ qua các hình vẽ', 'Dịch sang tiếng Anh'..."
                  className="w-full h-[104px] p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
                />
              </div>
            </div>
          </div>
        )}

        <main className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column: Upload & Controls */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <FileUp className="w-5 h-5 text-indigo-600" />
                Tải lên tài liệu
              </h2>
              
              {!file ? (
                <div 
                  {...getRootProps()} 
                  className={cn(
                    "border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all",
                    isDragActive ? "border-indigo-500 bg-indigo-50" : "border-gray-200 hover:border-indigo-400 hover:bg-gray-50"
                  )}
                >
                  <input {...getInputProps()} />
                  <div className="flex flex-col items-center">
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                      <FileUp className="w-6 h-6 text-gray-400" />
                    </div>
                    <p className="text-gray-600 font-medium">Kéo thả file PDF vào đây</p>
                    <p className="text-gray-400 text-sm mt-1">hoặc click để chọn file</p>
                  </div>
                </div>
              ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                          <FileText className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div className="overflow-hidden">
                          <p className="font-medium truncate max-w-[200px]">{file.name}</p>
                          <p className="text-xs text-gray-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                        </div>
                      </div>
                      <button 
                        onClick={reset}
                        className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                        title="Xóa file"
                        disabled={isProcessing}
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>

                    {!isProcessing && !result && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100/50">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
                              <FileText className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-gray-900">Ghép nhóm ngữ liệu</p>
                              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Tự động nhận diện nhóm</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setGroupSharedContext(!groupSharedContext)}
                            className={cn(
                              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none",
                              groupSharedContext ? "bg-indigo-600" : "bg-gray-200"
                            )}
                          >
                            <span
                              className={cn(
                                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                                groupSharedContext ? "translate-x-6" : "translate-x-1"
                              )}
                            />
                          </button>
                        </div>

                        <button
                          onClick={() => processFile(file)}
                          className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 animate-in fade-in zoom-in duration-300"
                        >
                          <FileUp className="w-5 h-5" />
                          Bắt đầu số hóa
                        </button>
                      </div>
                    )}

                    {isProcessing && (
                      <div className="space-y-2 mt-4">
                        <div className="flex justify-between text-xs font-medium text-indigo-600">
                          <span>{statusText}</span>
                          <span>{Math.round(progress)}%</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                          <div 
                            className="bg-indigo-600 h-full transition-all duration-300 ease-out"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                    
                    {!isProcessing && result && (
                      <div className="p-4 bg-green-50 border border-green-100 rounded-xl flex items-center gap-3 text-green-700">
                        <CheckCircle2 className="w-5 h-5" />
                        <p className="text-sm font-medium">Xử lý hoàn tất!</p>
                      </div>
                    )}
                  </div>
              )}

              {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-600">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold">{error.message}</p>
                    {error.code && <p className="text-xs mt-1 opacity-70">Mã lỗi: {error.code}</p>}
                    {error.link && (
                      <a 
                        href={error.link} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-xs mt-2 inline-block text-indigo-600 hover:underline font-medium"
                      >
                        Xem hướng dẫn khắc phục sự cố →
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Instructions */}
            <div className="bg-indigo-50 p-6 rounded-3xl border border-indigo-100">
              <h3 className="font-semibold text-indigo-900 mb-2">Hướng dẫn sử dụng</h3>
              <ul className="text-sm text-indigo-700 space-y-2 list-disc list-inside">
                <li>Tải lên file PDF chứa các câu hỏi trắc nghiệm, đúng sai, điền khuyết hoặc nối cột.</li>
                <li>Nhấn "Bắt đầu số hóa" để AI phân tích và trích xuất dữ liệu.</li>
                <li>Sử dụng tab <b>Raw</b> để xem dữ liệu thô từ AI nếu cần kiểm tra lỗi.</li>
                <li>Kiểm tra kết quả JSON hoặc Preview ở cột bên phải.</li>
                <li>Sao chép hoặc tải về file JSON để sử dụng.</li>
              </ul>
            </div>
          </div>

          {/* Right Column: Result Preview */}
          <div className="h-full">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 h-full flex flex-col min-h-[600px]">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    {viewMode === 'json' ? <FileJson className="w-5 h-5 text-indigo-600" /> : <Eye className="w-5 h-5 text-indigo-600" />}
                    {viewMode === 'json' ? 'Kết quả JSON' : 'Xem trước'}
                  </h2>
                  <div className="flex bg-gray-100 p-1 rounded-xl">
                    <button
                      onClick={() => setViewMode('json')}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5",
                        viewMode === 'json' ? "bg-white shadow-sm text-indigo-600" : "text-gray-500 hover:text-gray-700"
                      )}
                    >
                      <Code className="w-3.5 h-3.5" />
                      JSON
                    </button>
                    <button
                      onClick={() => setViewMode('preview')}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5",
                        viewMode === 'preview' ? "bg-white shadow-sm text-indigo-600" : "text-gray-500 hover:text-gray-700"
                      )}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Preview
                    </button>
                    <button
                      onClick={() => setViewMode('raw')}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5",
                        viewMode === 'raw' ? "bg-white shadow-sm text-indigo-600" : "text-gray-500 hover:text-gray-700"
                      )}
                    >
                      <AlertCircle className="w-3.5 h-3.5" />
                      Raw
                    </button>
                    <button
                      onClick={() => setViewMode('editor')}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5",
                        viewMode === 'editor' ? "bg-white shadow-sm text-indigo-600" : "text-gray-500 hover:text-gray-700"
                      )}
                    >
                      <EditIcon className="w-3.5 h-3.5" />
                      Editor
                    </button>
                  </div>
                </div>
                {result && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleCopy}
                      className="p-2 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors text-gray-600 flex items-center gap-2 text-sm font-medium"
                      title="Sao chép"
                    >
                      {copied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                      {copied ? 'Đã chép' : 'Sao chép'}
                    </button>
                    <button
                      onClick={handleDownload}
                      className="p-2 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors text-indigo-600 flex items-center gap-2 text-sm font-medium"
                      title="Tải về"
                    >
                      <Download className="w-4 h-4" />
                      Tải về
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 bg-gray-900 rounded-2xl p-4 overflow-auto font-mono text-sm relative group">
                {viewMode === 'editor' && result ? (
                  <div className="h-full w-full overflow-hidden rounded-2xl">
                    <QuestionEditor 
                      initialData={result}
                      onSave={(data) => {
                        setResult(data);
                      }}
                    />
                  </div>
                ) : viewMode === 'raw' ? (
                  rawText ? (
                    <pre className="text-indigo-300 whitespace-pre-wrap">
                      {rawText}
                      {isProcessing && <span className="inline-block w-2 h-4 bg-indigo-500 animate-pulse ml-1" />}
                    </pre>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600">
                      <AlertCircle className="w-12 h-12 mb-3 opacity-20" />
                      <p>Chưa có dữ liệu thô</p>
                    </div>
                  )
                ) : viewMode === 'json' ? (
                  rawText ? (
                    <div className="text-indigo-300 whitespace-pre-wrap">
                      <FormattedText text={rawText} isJson={true} />
                      {isProcessing && <span className="inline-block w-2 h-4 bg-indigo-500 animate-pulse ml-1" />}
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600">
                      <FileJson className="w-12 h-12 mb-3 opacity-20" />
                      <p>Chưa có dữ liệu</p>
                    </div>
                  )
                ) : (
                  <div className="bg-white rounded-xl p-6 font-sans text-gray-800 h-full overflow-auto">
                    {result?.questions ? (
                      <div className="space-y-12">
                        {/* Metadata Header */}
                        {result.metadata && (
                          <div className="mb-8 p-6 bg-indigo-50/50 rounded-3xl border border-indigo-100/50">
                            <h1 className="text-2xl font-bold text-gray-900 mb-3">{result.metadata.title || 'Đề thi chưa đặt tên'}</h1>
                            <div className="flex flex-wrap gap-2">
                              {result.metadata.subject && (
                                <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold uppercase tracking-wider">
                                  {result.metadata.subject}
                                </span>
                              )}
                              {result.metadata.grade && (
                                <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold uppercase tracking-wider">
                                  Lớp {result.metadata.grade}
                                </span>
                              )}
                              {result.metadata.time && (
                                <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-bold uppercase tracking-wider">
                                  {result.metadata.time}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Render Groups first */}
                        {result.groups?.length > 0 && (
                          <div className="space-y-8">
                            {result.groups.map((group: any) => (
                              <div key={group.id} className="bg-gray-50 rounded-3xl p-6 border border-indigo-100 shadow-sm relative overflow-hidden">
                                <div className="absolute top-0 right-0 px-4 py-1 bg-indigo-100 text-indigo-600 text-[10px] font-bold uppercase tracking-widest rounded-bl-xl">
                                  Group: {group.id}
                                </div>
                                <div className="flex items-center gap-2 mb-4 text-indigo-600">
                                  <FileText className="w-4 h-4" />
                                  <span className="text-xs font-bold uppercase tracking-wider">Ngữ liệu dùng chung</span>
                                </div>
                                <div className="prose prose-sm max-w-none mb-6 text-gray-700 leading-relaxed italic border-b border-indigo-50 pb-6">
                                  <FormattedText text={group.context} />
                                </div>
                                <div className="space-y-8">
                                  {result.questions
                                    .filter((q: any) => q.groupId === group.id)
                                    .map((q: any, qIdx: number) => (
                                      <QuestionItem key={q.id || qIdx} question={q} index={result.questions.indexOf(q) + 1} />
                                    ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Render Ungrouped Questions */}
                        <div className="space-y-8">
                          {result.questions
                            .filter((q: any) => !q.groupId || !result.groups?.find((g: any) => g.id === q.groupId))
                            .map((q: any, qIdx: number) => (
                              <QuestionItem key={q.id || qIdx} question={q} index={result.questions.indexOf(q) + 1} />
                            ))}
                        </div>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-gray-400">
                        <Eye className="w-12 h-12 mb-3 opacity-20" />
                        <p>Chưa có dữ liệu để xem trước</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="mt-12 text-center text-gray-400 text-sm">
          <p>© 2024 PDF Digitizer AI. Powered by Google Gemini.</p>
        </footer>
      </div>
    </div>
  );
}
