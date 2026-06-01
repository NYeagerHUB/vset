import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const quizSchema = {
  type: Type.OBJECT,
  properties: {
    metadata: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "Exam title" },
        subject: { type: Type.STRING, description: "Subject (Math, Physics, Chemistry, etc.)" },
        grade: { type: Type.STRING, description: "Grade level" },
        time: { type: Type.STRING, description: "Time limit" },
      }
    },
    groups: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "Unique ID for the group" },
          context: { type: Type.STRING, description: "The shared context/material text for this group of questions" },
          questionIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of question IDs belonging to this group" },
        },
        required: ["id", "context", "questionIds"],
      },
      description: "Groups of questions that share the same context or material",
    },
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "Question number or ID" },
          type: {
            type: Type.STRING,
            description: "Type of question: 'mcq' (Multiple Choice), 'truefalse' (True/False Table), 'short' (Short Answer/Fill-in), or 'matching' (Matching Columns)",
          },
          question: {
            type: Type.STRING,
            description: "The main question text or prompt.",
          },
          options: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Options for MCQ (A, B, C, D)",
          },
          answer: {
            type: Type.STRING,
            description: "The correct answer. For MCQ, use the index (0-3). For Short, use the text.",
          },
          statements: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Sub-statements for True/False tables (e.g., 1, 2, 3, 4 in a table)",
          },
          answers: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Answers for True/False ('T' for True, 'F' for False) or indices for matching",
          },
          placeholder: {
            type: Type.STRING,
            description: "Placeholder text for short answer input",
          },
          left: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Left column items for matching",
          },
          right: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Right column items for matching",
          },
          explanation: {
            type: Type.STRING,
            description: "Explanation for the answer if available",
          },
          hasImage: {
            type: Type.BOOLEAN,
            description: "True if the question contains an image/diagram in the PDF",
          },
          imageDescription: {
            type: Type.STRING,
            description: "Detailed description of the image or diagram if present",
          },
          graph: {
            type: Type.OBJECT,
            description: "Optional math coordinates, functions, points, segments, annotations, and integration shaded regions to draw if this question contains a coordinate graph diagram.",
            properties: {
              title: { type: Type.STRING, description: "Title or label for the graph" },
              xAxis: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  min: { type: Type.NUMBER },
                  max: { type: Type.NUMBER },
                  ticks: { type: Type.ARRAY, items: { type: Type.NUMBER } }
                }
              },
              yAxis: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  min: { type: Type.NUMBER },
                  max: { type: Type.NUMBER },
                  ticks: { type: Type.ARRAY, items: { type: Type.NUMBER } }
                }
              },
              curves: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING, description: "Type: 'equation' or 'points'" },
                    equation: { type: Type.STRING, description: "Math formula using 'x', e.g., 'x^3 - 3*x', '4*sin(2*x) + 2', '-0.5*(x-5)^2 + 9'" },
                    points: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.NUMBER } }, description: "Array of coordinates [[x,y], [x2,y2]]" },
                    label: { type: Type.STRING },
                    color: { type: Type.STRING, description: "Color of the curve (e.g., '#4338CA' or hex)" },
                    range: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "Domain range [min_x, max_x]" },
                    dash: { type: Type.BOOLEAN }
                  },
                  required: ["type"]
                }
              },
              points: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    x: { type: Type.NUMBER },
                    y: { type: Type.NUMBER },
                    label: { type: Type.STRING, description: "Label next to the point (e.g., A, B, extreme value, etc.)" },
                    showCoordinates: { type: Type.BOOLEAN },
                    align: { type: Type.STRING, description: "Alignment: 'top', 'bottom', 'left', 'right'" }
                  },
                  required: ["x", "y"]
                }
              },
              annotations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING, description: "Type: 'line', 'segment' (for dashed projection lines), 'shade' (for integral area shading), 'text'" },
                    x1: { type: Type.NUMBER },
                    y1: { type: Type.NUMBER },
                    x2: { type: Type.NUMBER },
                    y2: { type: Type.NUMBER },
                    text: { type: Type.STRING },
                    color: { type: Type.STRING },
                    dash: { type: Type.BOOLEAN },
                    range: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "[start_x, end_x] for shade" },
                    curveIndex: { type: Type.NUMBER }
                  },
                  required: ["type"]
                }
              }
            }
          },
          groupId: {
            type: Type.STRING,
            description: "ID of the group this question belongs to, if any",
          }
        },
        required: ["type", "question"],
      },
    },
  },
  required: ["questions"],
};

export interface DigitizeOptions {
  allowedTypes: string[];
  customInstructions?: string;
  groupSharedContext?: boolean;
}

export async function* digitizePdfStream(fileBase64: string, mimeType: string, options: DigitizeOptions) {
  const model = "gemini-2.5-flash-preview-05-20";
  
  const response = await ai.models.generateContentStream({
    model,
    contents: [
      {
        parts: [
          {
            inlineData: {
              data: fileBase64,
              mimeType: mimeType,
            },
          },
          {
            text: `You are an expert Exam Digitizer specialized in Vietnamese National High School Exam formats (V-SAT, THPT Quốc gia). Your task is to extract ALL questions from the provided PDF and convert them into a structured JSON format.

AI STRATEGY FOR VIETNAMESE EXAMS:
1. **Structural Analysis**: 
   - Identify the exam header (Title, Subject, Grade, Mã đề).
   - Recognize the 3-part structure common in 2025 formats:
     - **Phần I**: Multiple choice questions (4 options A, B, C, D). Map to 'mcq'.
     - **Phần II**: True/False tables. Each "Câu" has 4 sub-statements (a, b, c, d). Map to 'truefalse'. The sub-statements go into 'statements' array.
     - **Phần III**: Short answer questions. Map to 'short'.
   - Detect "Matching" (Ghép nối) sections if present. Map to 'matching'.

2. **Context & Grouping Handling (CRITICAL)**:
   - **Automatic Identification**: You MUST scan the document for shared context, such as reading passages, data tables, or introductory text that applies to multiple questions (e.g., "Dùng dữ liệu sau cho câu 1, 2, 3").
   - **Grouping**: If multiple questions share a common context, you MUST:
     - Create a group in the 'groups' array with a unique ID and the shared 'context'.
     - Assign the 'groupId' to each relevant question.
     - Ensure the 'question' field for each question is distinct and specific to that question's prompt.
   - If 'groupSharedContext' is true, you MUST prioritize this grouping structure. If false, you may still group if it's essential for clarity, but try to keep questions independent.

3. **Data Tables as LaTeX**:
   - If a question or context contains a data table, convert it into a LaTeX **array** environment.
   - Example: $$\\begin{array}{|c|c|} \\hline A & B \\\\ \\hline 1 & 2 \\\\ \\hline \\end{array}$$
   - Do NOT use 'tabular' as it is not supported by KaTeX.

4. **Image Detection & Graph Redrawing (CRITICAL — DO NOT SKIP)**:
   - You are receiving the PDF as an IMAGE. You CAN and MUST read all visual content including graphs, diagrams, and figures.
   - For EVERY question that has a graph, diagram, figure, or visual element: set 'hasImage' to true.
   - If the image is a coordinate graph or mathematical chart (parabolas, cubic curves, velocity/time lines, trigonometric graphs, derivative graphs, shaded integration regions):
     - You MUST fill in the 'graph' object. This is MANDATORY, not optional.
     - Carefully read the axis labels and tick marks from the image to calibrate xAxis/yAxis min/max/ticks.
     - Under 'curves': use type 'equation' with a JS-evaluatable string (e.g. 'x^3 - 3*x') for smooth curves, or type 'points' with coordinate arrays for piecewise lines.
     - Under 'points': mark all labeled points (extrema, intersections, special values) visible in the diagram.
     - Under 'annotations': add dashed projection lines (type 'segment', dash: true) from key points to axes, and shading (type 'shade') for integration areas like S1, S2.
   - NEVER leave graph as null/empty if you can see a mathematical graph in the PDF.

5. **Question Recognition Details**: 
   - **MCQ**: Extract question text, options (A, B, C, D), and identify the correct answer if marked.
   - **True/False**: Extract the main prompt and the 4 specific statements. Identify 'T' (Đúng) or 'F' (Sai) for each.
   - **Short Answer**: Extract the question and the numeric/text answer.

6. **Content Extraction & LaTeX**:
   - **LaTeX is MANDATORY**: Use LaTeX for ALL math, chemistry, and physics content.
     - Inline: $...$ (e.g., $x^2 + 2x + 1 = 0$)
     - Block: $$...$$ (e.g., $$\\int_{0}^{1} x dx$$)
     - Chemical: $H_2SO_4$, $Fe^{2+}$, $\\rightarrow$.
   - **OCR Cleaning**: Remove page numbers, headers/footers, and watermarks.

7. **Filtering**: Only include these types: ${options.allowedTypes.join(', ')}.

${options.customInstructions ? `USER CUSTOM INSTRUCTIONS: ${options.customInstructions}` : ''}

OUTPUT FORMAT:
- Return ONLY valid JSON.
- No markdown formatting.
- Strictly follow the schema.
- Be extremely precise with LaTeX and question numbering.
- NEVER skip a question that has a graph — always fill in the graph object.`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: quizSchema,
    },
  });

  for await (const chunk of response) {
    if (chunk.text) {
      yield chunk.text;
    }
  }
}
