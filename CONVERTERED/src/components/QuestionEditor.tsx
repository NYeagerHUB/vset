import React, { useState, useCallback, useRef, useEffect } from 'react';
import { InlineMath, BlockMath } from 'react-katex';
import { clsx } from 'clsx';

// Types
interface Question {
  id: string;
  type: 'mcq' | 'truefalse' | 'short' | 'matching';
  question: string;
  options?: string[];
  answer?: string;
  answers?: string[];
  statements?: string[];
  left?: string[];
  right?: string[];
  hasImage?: boolean;
  graph?: any;
  imageDescription?: string;
  explanation?: string;
  groupId?: string;
  status: 'complete' | 'incomplete' | 'needs-review';
}

interface ExamData {
  metadata?: {
    title?: string;
    subject?: string;
    grade?: string;
    time?: string;
  };
  questions: Question[];
}

// Status type
type QuestionStatus = 'complete' | 'incomplete' | 'needs-review';

// Helper to render text with LaTeX
const FormattedText = ({ text, isJson = false }: { text: string; isJson?: boolean }) => {
  if (!text) return null;
  
  const processedText = isJson ? text.replace(/\\\\/g, '\\') : text;
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

// Drag Handle Icon
const DragHandle = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 6.5C4 7.32843 3.32843 8 2.5 8C1.67157 8 1 7.32843 1 6.5C1 5.67157 1.67157 5 2.5 5C3.32843 5 4 5.67157 4 6.5Z" stroke="currentColor" strokeWidth="1.5" stroke Linecap="round" strokeLinejoin="round"/>
    <path d="M4 11.5C4 12.3284 3.32843 13 2.5 13C1.67157 13 1 12.3284 1 11.5C1 10.6716 1.67157 10 2.5 10C3.32843 10 4 10.6716 4 11.5Z" stroke="currentColor" strokeWidth="1.5" stroke Linecap="round" strokeLinejoin="round"/>
    <path d="M14 6.5C14 7.32843 13.3284 8 12.5 8C11.6716 8 11 7.32843 11 6.5C11 5.67157 11.6716 5 12.5 5C13.3284 5 14 5.67157 14 6.5Z" stroke="currentColor" strokeWidth="1.5" stroke Linecap="round" strokeLinejoin="round"/>
    <path d="M14 11.5C14 12.3284 13.3284 13 12.5 13C11.6716 13 11 12.3284 11 11.5C11 10.6716 11.6716 10 12.5 10C13.3284 10 14 10.6716 14 11.5Z" stroke="currentColor" strokeWidth="1.5" stroke Linecap="round" strokeLinejoin="round"/>
  </svg>
);

// Review Icon
const ReviewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 1V3M8 13V15M1 8H3M13 8H15M3.05 3.05L4.46 4.46M11.54 11.54L12.95 12.95M3.05 12.95L4.46 11.54M11.54 4.46L12.95 3.05" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

// Check Icon
const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 8L6.5 11.5L13 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Warning Icon
const WarningIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 5V8.5M8 11H8.01M2.93 13H13.07C14.05 13 14.84 12.15 14.77 11.17L14.27 4.17C14.2 3.19 13.41 2.5 12.43 2.5H3.57C2.59 2.5 1.8 3.19 1.73 4.17L1.23 11.17C1.16 12.15 1.95 13 2.93 13Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Edit Icon
const EditIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.5 2.5L13.5 4.5M2 14L3.5 9.5L12 1L15 4L6.5 12.5L2 14Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Group Icon
const GroupIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="3" width="6" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="9" y="1" width="6" height="14" rx="1" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

// Ungroup Icon
const UngroupIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="3" width="6" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="9" y="3" width="6" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

// Math Suggestion Icon
const MathIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 3L2 13M14 3L12 13M4 8H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Lightbulb Icon (AI Suggestion)
const LightbulbIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 1V2M8 14V15M1 8H2M14 8H15M3.05 3.05L3.76 3.76M12.24 12.24L12.95 12.95M3.05 12.95L3.76 12.24M12.24 3.76L12.95 3.05" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M6 14.5C6 12.01 7.79 10 10 10C12.21 10 14 12.01 14 14.5V15H6V14.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Question Editor Props
interface QuestionEditorProps {
  initialData?: ExamData;
  onSave?: (data: ExamData) => void;
}

// Main QuestionEditor Component
export function QuestionEditor({ initialData, onSave }: QuestionEditorProps) {
  const [darkMode, setDarkMode] = useState(false);
  const [questions, setQuestions] = useState<Question[]>(initialData?.questions || []);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [showAiPanel, setShowAiPanel] = useState(true);

  // Auto-select first question
  useEffect(() => {
    if (questions.length > 0 && !selectedQuestionId) {
      setSelectedQuestionId(questions[0].id);
    }
  }, [questions, selectedQuestionId]);

  // Color tokens
  const colors = darkMode ? {
    bg: '#0F1115',
    surface: '#171A21',
    border: '#2A2F3A',
    textPrimary: '#F5F5F5',
    textSecondary: '#A1A1AA',
  } : {
    bg: '#FAFAF7',
    surface: '#FFFFFF',
    border: '#E5E5E5',
    textPrimary: '#111111',
    textSecondary: '#666666',
  };

  // Get status color
  const getStatusColor = (status: QuestionStatus) => {
    switch (status) {
      case 'complete': return darkMode ? '#22c55e' : '#16a34a';
      case 'incomplete': return darkMode ? '#ef4444' : '#dc2626';
      case 'needs-review': return darkMode ? '#eab308' : '#ca8a04';
    }
  };

  // Get status label
  const getStatusLabel = (status: QuestionStatus) => {
    switch (status) {
      case 'complete': return 'Hoàn chỉnh';
      case 'incomplete': return 'Thiếu dữ liệu';
      case 'needs-review': return 'Cần kiểm tra AI';
    }
  };

  // Analyze question for issues
  const analyzeQuestion = useCallback((q: Question): string[] => {
    const issues: string[] = [];
    
    if (!q.question || q.question.trim() === '') {
      issues.push('Câu hỏi trống');
    }
    
    if (q.type === 'mcq') {
      if (!q.options || q.options.length === 0) {
        issues.push('Không có đáp án');
      }
      if (!q.answer) {
        issues.push('Thiếu đáp án đúng');
      }
    }
    
    if (q.type === 'truefalse') {
      if (!q.statements || q.statements.length === 0) {
        issues.push('Không có mệnh đề');
      }
      if (!q.answers || q.answers.length === 0) {
        issues.push('Thiếu đáp án');
      }
    }
    
    if (q.type === 'short' && !q.answer) {
      issues.push('Thiếu đáp án tự luận');
    }
    
    if (q.type === 'matching') {
      if (!q.left || q.left.length === 0) {
        issues.push('Thiếu cột trái');
      }
      if (!q.right || q.right.length === 0) {
        issues.push('Thiếu cột phải');
      }
    }
    
    if (q.hasImage && !q.imageDescription) {
      issues.push('Thiếu mô tả hình ảnh');
    }
    
    // Check for potential OCR issues
    if (q.question && /[Il1|]/.test(q.question) && q.question.length > 10) {
      issues.push('Có thể lỗi OCR');
    }
    
    return issues;
  }, []);

  // Run AI Review
  const runAiReview = useCallback(() => {
    const allSuggestions: string[] = [];
    
    questions.forEach((q, idx) => {
      const issues = analyzeQuestion(q);
      if (issues.length > 0) {
        allSuggestions.push(`Câu ${idx + 1}: ${issues.join(', ')}`);
      }
    });
    
    // Add general suggestions
    if (questions.length === 0) {
      allSuggestions.push('Chưa có câu hỏi nào');
    }
    
    // Check for group consistency
    const groupedQuestions = questions.filter(q => q.groupId);
    if (groupedQuestions.length > 0) {
      const groupedIds = new Set(groupedQuestions.map(q => q.groupId));
      groupedIds.forEach(gid => {
        const group = questions.filter(q => q.groupId === gid);
        if (group.length < 2) {
          allSuggestions.push(`Nhóm ${gid} chỉ có ${group.length} câu (nên có ít nhất 2)`);
        }
      });
    }
    
    setAiSuggestions(allSuggestions);
    setShowAiPanel(true);
  }, [questions, analyzeQuestion]);

  // Handle drag
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) return;

    const newQuestions = [...questions];
    const draggedIndex = newQuestions.findIndex(q => q.id === draggedId);
    const targetIndex = newQuestions.findIndex(q => q.id === targetId);
    
    const [removed] = newQuestions.splice(draggedIndex, 1);
    newQuestions.splice(targetIndex, 0, removed);
    
    setQuestions(newQuestions);
    setDraggedId(null);
  };

  // Update question
  const updateQuestion = (id: string, updates: Partial<Question>) => {
    setQuestions(prev => prev.map(q => {
      if (q.id !== id) return q;
      
      const updated = { ...q, ...updates };
      
      // Auto-detect status
      const issues = analyzeQuestion({ ...updated });
      if (issues.length === 0) {
        updated.status = 'complete';
      } else if (issues.some(i => i.includes('OCR') || i.includes('AI'))) {
        updated.status = 'needs-review';
      } else {
        updated.status = 'incomplete';
      }
      
      return updated;
    }));
  };

  // Group questions
  const groupQuestions = (ids: string[]) => {
    if (ids.length < 2) return;
    
    const groupId = `group-${Date.now()}`;
    setQuestions(prev => prev.map(q => {
      if (ids.includes(q.id)) {
        return { ...q, groupId };
      }
      return q;
    }));
  };

  // Ungroup questions
  const ungroupQuestions = (groupId: string) => {
    setQuestions(prev => prev.map(q => {
      if (q.groupId === groupId) {
        const { groupId: _, ...rest } = q;
        return rest as Question;
      }
      return q;
    }));
  };

  // Selected question
  const selectedQuestion = questions.find(q => q.id === selectedQuestionId);

  // Inline editor component
  const InlineEditor = ({ 
    value, 
    onChange, 
    multiline = false,
    placeholder = 'Nhập nội dung...'
  }: { 
    value: string; 
    onChange: (v: string) => void; 
    multiline?: boolean;
    placeholder?: string;
  }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [localValue, setLocalValue] = useState(value);
    const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

    useEffect(() => {
      setLocalValue(value);
    }, [value]);

    useEffect(() => {
      if (isEditing && inputRef.current) {
        inputRef.current.focus();
      }
    }, [isEditing]);

    const handleBlur = () => {
      setIsEditing(false);
      if (localValue !== value) {
        onChange(localValue);
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLocalValue(value);
        setIsEditing(false);
      }
      if (e.key === 'Enter' && !multiline && !e.shiftKey) {
        e.preventDefault();
        handleBlur();
      }
    };

    if (isEditing) {
      if (multiline) {
        return (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className={clsx(
              "w-full bg-transparent border-none outline-none resize-none font-inherit",
              "placeholder:text-gray-400"
            )}
            placeholder={placeholder}
            rows={3}
          />
        );
      }
      return (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent border-none outline-none font-inherit placeholder:text-gray-400"
          placeholder={placeholder}
        />
      );
    }

    return (
      <div 
        onClick={() => setIsEditing(true)}
        className={clsx(
          "cursor-text rounded transition-colors",
          !value && "text-gray-400",
          value && "hover:bg-black/5 dark:hover:bg-white/5"
        )}
      >
        {value || placeholder}
      </div>
    );
  };

  // AI Latex Suggestion Component
  const LatexSuggestion = ({ onSelect }: { onSelect: (latex: string) => void }) => {
    const suggestions = [
      { trigger: 'integral', label: 'Tích phân', latex: '\\int_{a}^{b} f(x) dx' },
      { trigger: 'dao ham', label: 'Đạo hàm', latex: '\\frac{d}{dx}' },
      { trigger: 'can', label: 'Căn bậc', latex: '\\sqrt{}' },
      { trigger: 'phan so', label: 'Phân số', latex: '\\frac{a}{b}' },
      { trigger: 'mu', label: 'Mũ', latex: 'x^{n}' },
      { trigger: 'chi so', label: 'Chỉ số dưới', latex: 'x_{i}' },
      { trigger: 'tong', label: 'Tổng', latex: '\\sum_{i=1}^{n}' },
      { trigger: 'tich', label: 'Tích', latex: '\\prod_{i=1}^{n}' },
      { trigger: 'lim', label: 'Giới hạn', latex: '\\lim_{x \\to a}' },
      { trigger: 'vo cuc', label: 'Vô cùng', latex: '\\infty' },
    ];

    return (
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider font-semibold opacity-50">Gợi ý LaTeX</p>
        <div className="grid grid-cols-2 gap-1">
          {suggestions.map(s => (
            <button
              key={s.trigger}
              onClick={() => onSelect(s.latex)}
              className={clsx(
                "px-2 py-1.5 text-xs rounded border transition-colors text-left",
                "border-[var(--border)] hover:border-[var(--text-secondary)]",
                "hover:bg-black/5 dark:hover:bg-white/5"
              )}
            >
              <span className="opacity-60">{s.label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  // Question Type Badge
  const TypeBadge = ({ type }: { type: Question['type'] }) => {
    const labels = {
      mcq: 'Trắc nghiệm',
      truefalse: 'Đúng/Sai',
      short: 'Tự luận',
      matching: 'Nối cột'
    };
    
    return (
      <span className={clsx(
        "px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded border",
        "border-[var(--border)] text-[var(--text-secondary)]"
      )}>
        {labels[type]}
      </span>
    );
  };

  return (
    <div 
      className="h-screen flex flex-col overflow-hidden"
      style={{ 
        backgroundColor: colors.bg, 
        color: colors.textPrimary,
        '--border': colors.border,
        '--text-secondary': colors.textSecondary,
      } as React.CSSProperties}
    >
      {/* Top Bar */}
      <header 
        className="flex items-center justify-between px-6 h-14 border-b flex-shrink-0"
        style={{ borderColor: colors.border, backgroundColor: colors.surface }}
      >
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-semibold tracking-tight">Question Editor</h1>
          <span className="text-[var(--text-secondary)] text-xs">|</span>
          <span className="text-[var(--text-secondary)] text-xs">
            {initialData?.metadata?.title || 'Untitled Exam'}
          </span>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="px-3 py-1.5 text-xs border rounded transition-colors"
            style={{ borderColor: colors.border }}
          >
            {darkMode ? 'Light' : 'Dark'}
          </button>
          <button
            onClick={runAiReview}
            className="px-4 py-1.5 text-xs font-medium bg-black text-white dark:bg-white dark:text-black rounded transition-colors"
          >
            Review Exam
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT SIDEBAR */}
        <aside 
          className="w-64 border-r flex flex-col flex-shrink-0 overflow-hidden"
          style={{ borderColor: colors.border, backgroundColor: colors.surface }}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: colors.border }}>
            <span className="text-[10px] uppercase tracking-wider font-semibold opacity-50">
              Danh sách câu hỏi
            </span>
            <span className="text-[10px] opacity-50">{questions.length}</span>
          </div>

          {/* Question List */}
          <div className="flex-1 overflow-y-auto">
            {questions.map((q, idx) => (
              <div
                key={q.id}
                draggable
                onDragStart={(e) => handleDragStart(e, q.id)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, q.id)}
                onClick={() => setSelectedQuestionId(q.id)}
                className={clsx(
                  "group px-4 py-3 border-b cursor-pointer transition-colors",
                  "flex items-start gap-3",
                  selectedQuestionId === q.id && "bg-black/5 dark:bg-white/5"
                )}
                style={{ borderColor: colors.border }}
              >
                {/* Drag Handle */}
                <div className="flex-shrink-0 pt-0.5 opacity-0 group-hover:opacity-30 transition-opacity cursor-grab">
                  <DragHandle />
                </div>

                {/* Number */}
                <span 
                  className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border"
                  style={{ borderColor: colors.border }}
                >
                  {idx + 1}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <TypeBadge type={q.type} />
                    <span 
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: getStatusColor(q.status) }}
                    />
                  </div>
                  <p className="text-xs truncate opacity-70">
                    {q.question?.slice(0, 40) || 'Chưa có nội dung'}
                    {(q.question?.length || 0) > 40 && '...'}
                  </p>
                  {q.groupId && (
                    <span className="text-[9px] mt-1 opacity-40">
                      <GroupIcon /> {q.groupId}
                    </span>
                  )}
                </div>
              </div>
            ))}

            {questions.length === 0 && (
              <div className="px-4 py-8 text-center">
                <p className="text-xs opacity-30">Chưa có câu hỏi nào</p>
              </div>
            )}
          </div>

          {/* Status Legend */}
          <div className="px-4 py-3 border-t space-y-1.5" style={{ borderColor: colors.border }}>
            <p className="text-[9px] uppercase tracking-wider font-semibold opacity-30 mb-2">Trạng thái</p>
            {(['complete', 'incomplete', 'needs-review'] as QuestionStatus[]).map(status => (
              <div key={status} className="flex items-center gap-2">
                <span 
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: getStatusColor(status) }}
                />
                <span className="text-[10px] opacity-60">{getStatusLabel(status)}</span>
              </div>
            ))}
          </div>
        </aside>

        {/* CENTER EDITOR */}
        <main className="flex-1 overflow-y-auto">
          {selectedQuestion ? (
            <div className="max-w-3xl mx-auto px-12 py-8">
              {/* Question Header */}
              <div className="mb-8">
                <div className="flex items-center gap-3 mb-4">
                  <span 
                    className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold border-2"
                    style={{ borderColor: colors.border }}
                  >
                    {questions.findIndex(q => q.id === selectedQuestion.id) + 1}
                  </span>
                  <TypeBadge type={selectedQuestion.type} />
                  <span 
                    className="px-2 py-0.5 text-[9px] uppercase tracking-wider rounded border"
                    style={{ borderColor: colors.border }}
                  >
                    {selectedQuestion.status === 'complete' ? <CheckIcon /> : selectedQuestion.status === 'incomplete' ? <WarningIcon /> : <ReviewIcon />}
                  </span>
                </div>

                {/* Question Content */}
                <div className="text-lg leading-relaxed">
                  <InlineEditor
                    value={selectedQuestion.question}
                    onChange={(v) => updateQuestion(selectedQuestion.id, { question: v })}
                    placeholder="Nhập nội dung câu hỏi..."
                    multiline
                  />
                </div>
              </div>

              {/* Options for MCQ */}
              {selectedQuestion.type === 'mcq' && (
                <div className="space-y-3 mb-8">
                  {selectedQuestion.options?.map((opt, idx) => (
                    <div 
                      key={idx}
                      className="flex items-center gap-3 p-4 rounded border transition-colors"
                      style={{ 
                        borderColor: colors.border,
                        backgroundColor: selectedQuestion.answer === String(idx) 
                          ? (darkMode ? 'rgba(34, 197, 94, 0.1)' : 'rgba(22, 163, 74, 0.05)')
                          : 'transparent'
                      }}
                    >
                      <span 
                        className="w-8 h-8 rounded border flex items-center justify-center text-sm font-bold flex-shrink-0"
                        style={{ 
                          borderColor: colors.border,
                          backgroundColor: selectedQuestion.answer === String(idx) 
                            ? getStatusColor('complete') 
                            : 'transparent'
                        }}
                      >
                        {selectedQuestion.answer === String(idx) ? (
                          <span className="text-white"><CheckIcon /></span>
                        ) : (
                          String.fromCharCode(65 + idx)
                        )}
                      </span>
                      <div className="flex-1">
                        <InlineEditor
                          value={opt}
                          onChange={(v) => {
                            const newOptions = [...(selectedQuestion.options || [])];
                            newOptions[idx] = v;
                            updateQuestion(selectedQuestion.id, { options: newOptions });
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  
                  {/* Add Option Button */}
                  <button
                    onClick={() => {
                      const newOptions = [...(selectedQuestion.options || []), ''];
                      updateQuestion(selectedQuestion.id, { options: newOptions });
                    }}
                    className="w-full p-3 border border-dashed rounded text-xs opacity-50 hover:opacity-100 transition-opacity"
                    style={{ borderColor: colors.border }}
                  >
                    + Thêm đáp án
                  </button>
                </div>
              )}

              {/* Statements for True/False */}
              {selectedQuestion.type === 'truefalse' && (
                <div className="space-y-3 mb-8">
                  {selectedQuestion.statements?.map((stmt, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <div className="flex-1 p-4 rounded border" style={{ borderColor: colors.border }}>
                        <InlineEditor
                          value={stmt}
                          onChange={(v) => {
                            const newStmts = [...(selectedQuestion.statements || [])];
                            newStmts[idx] = v;
                            updateQuestion(selectedQuestion.id, { statements: newStmts });
                          }}
                        />
                      </div>
                      <div className="flex gap-1">
                        {['T', 'S'].map(ans => (
                          <button
                            key={ans}
                            onClick={() => {
                              const newAnswers = [...(selectedQuestion.answers || [])];
                              newAnswers[idx] = ans;
                              updateQuestion(selectedQuestion.id, { answers: newAnswers });
                            }}
                            className={clsx(
                              "w-10 h-10 rounded border text-xs font-bold transition-colors",
                              selectedQuestion.answers?.[idx] === ans
                                ? ans === 'T' 
                                  ? "bg-green-500 text-white border-green-500"
                                  : "bg-red-500 text-white border-red-500"
                                : "border-[var(--border)]"
                            )}
                          >
                            {ans}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Short Answer */}
              {selectedQuestion.type === 'short' && (
                <div className="mb-8">
                  <p className="text-[10px] uppercase tracking-wider font-semibold opacity-50 mb-2">Đáp án</p>
                  <div className="p-4 rounded border" style={{ borderColor: colors.border }}>
                    <InlineEditor
                      value={selectedQuestion.answer || ''}
                      onChange={(v) => updateQuestion(selectedQuestion.id, { answer: v })}
                      placeholder="Nhập đáp án..."
                    />
                  </div>
                </div>
              )}

              {/* Matching */}
              {selectedQuestion.type === 'matching' && (
                <div className="mb-8 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-semibold opacity-50 mb-2">Cột trái</p>
                    <div className="space-y-2">
                      {selectedQuestion.left?.map((item, idx) => (
                        <div key={idx} className="p-3 rounded border" style={{ borderColor: colors.border }}>
                          <InlineEditor
                            value={item}
                            onChange={(v) => {
                              const newLeft = [...(selectedQuestion.left || [])];
                              newLeft[idx] = v;
                              updateQuestion(selectedQuestion.id, { left: newLeft });
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-semibold opacity-50 mb-2">Cột phải</p>
                    <div className="space-y-2">
                      {selectedQuestion.right?.map((item, idx) => (
                        <div key={idx} className="p-3 rounded border bg-black/[0.02] dark:bg-white/[0.02]" style={{ borderColor: colors.border }}>
                          <InlineEditor
                            value={item}
                            onChange={(v) => {
                              const newRight = [...(selectedQuestion.right || [])];
                              newRight[idx] = v;
                              updateQuestion(selectedQuestion.id, { right: newRight });
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* LaTeX Preview */}
              <div className="mb-8 p-6 rounded border" style={{ borderColor: colors.border }}>
                <p className="text-[10px] uppercase tracking-wider font-semibold opacity-50 mb-4">Preview</p>
                <div className="text-center py-4 bg-black/[0.02] dark:bg-white/[0.02] rounded">
                  <FormattedText text={selectedQuestion.question || ''} />
                </div>
              </div>

              {/* Question Actions */}
              <div className="flex items-center gap-3 pt-6 border-t" style={{ borderColor: colors.border }}>
                <button
                  onClick={() => {
                    const issues = analyzeQuestion(selectedQuestion);
                    setAiSuggestions([`Câu ${questions.findIndex(q => q.id === selectedQuestion.id) + 1}: ${issues.join(', ')}`]);
                    setShowAiPanel(true);
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-xs border rounded transition-colors"
                  style={{ borderColor: colors.border }}
                >
                  <ReviewIcon />
                  Kiểm tra
                </button>
                
                {selectedQuestion.groupId ? (
                  <button
                    onClick={() => ungroupQuestions(selectedQuestion.groupId!)}
                    className="flex items-center gap-2 px-3 py-2 text-xs border rounded transition-colors"
                    style={{ borderColor: colors.border }}
                  >
                    <UngroupIcon />
                    Tách nhóm
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      const idx = questions.findIndex(q => q.id === selectedQuestion.id);
                      if (idx > 0) {
                        groupQuestions([questions[idx - 1].id, selectedQuestion.id]);
                      }
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-xs border rounded transition-colors"
                    style={{ borderColor: colors.border }}
                  >
                    <GroupIcon />
                    Gộp nhóm
                  </button>
                )}

                <button
                  onClick={() => {
                    setQuestions(prev => prev.filter(q => q.id !== selectedQuestion.id));
                    setSelectedQuestionId(questions.find(q => q.id !== selectedQuestion.id)?.id || null);
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-xs border rounded transition-colors text-red-500"
                  style={{ borderColor: colors.border }}
                >
                  Xóa
                </button>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm opacity-30">Chọn một câu hỏi để chỉnh sửa</p>
            </div>
          )}
        </main>

        {/* RIGHT PANEL - AI Assistant */}
        {showAiPanel && (
          <aside 
            className="w-72 border-l flex flex-col flex-shrink-0 overflow-hidden"
            style={{ borderColor: colors.border, backgroundColor: colors.surface }}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: colors.border }}>
              <span className="text-[10px] uppercase tracking-wider font-semibold opacity-50">
                AI Assistant
              </span>
              <button 
                onClick={() => setShowAiPanel(false)}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                ×
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* LaTeX Suggestions */}
              <LatexSuggestion 
                onSelect={(latex) => {
                  if (selectedQuestion) {
                    updateQuestion(selectedQuestion.id, { 
                      question: selectedQuestion.question + ` $${latex}$ ` 
                    });
                  }
                }}
              />

              {/* AI Suggestions List */}
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wider font-semibold opacity-50">
                  Phát hiện vấn đề
                </p>
                
                {aiSuggestions.length > 0 ? (
                  <div className="space-y-2">
                    {aiSuggestions.map((suggestion, idx) => (
                      <div 
                        key={idx}
                        className="p-3 rounded border text-xs"
                        style={{ borderColor: colors.border }}
                      >
                        {suggestion}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs opacity-30">Không có vấn đề được phát hiện</p>
                )}
              </div>

              {/* Quick Actions */}
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wider font-semibold opacity-50">
                  Thao tác nhanh
                </p>
                <div className="space-y-1">
                  <button
                    onClick={() => {
                      if (selectedQuestion) {
                        updateQuestion(selectedQuestion.id, { status: 'needs-review' });
                      }
                    }}
                    className="w-full p-2 text-left text-xs border rounded transition-colors"
                    style={{ borderColor: colors.border }}
                  >
                    <ReviewIcon /> Đánh dấu cần kiểm tra AI
                  </button>
                  <button
                    onClick={() => {
                      if (selectedQuestion) {
                        updateQuestion(selectedQuestion.id, { status: 'complete' });
                      }
                    }}
                    className="w-full p-2 text-left text-xs border rounded transition-colors"
                    style={{ borderColor: colors.border }}
                  >
                    <CheckIcon /> Đánh dấu hoàn chỉnh
                  </button>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Footer Status Bar */}
      <footer 
        className="px-6 h-8 border-t flex items-center justify-between text-[10px] opacity-50 flex-shrink-0"
        style={{ borderColor: colors.border }}
      >
        <span>{questions.length} câu hỏi</span>
        <span>
          {questions.filter(q => q.status === 'complete').length} hoàn chỉnh ·{' '}
          {questions.filter(q => q.status === 'incomplete').length} thiếu dữ liệu ·{' '}
          {questions.filter(q => q.status === 'needs-review').length} cần kiểm tra
        </span>
      </footer>
    </div>
  );
}

export default QuestionEditor;