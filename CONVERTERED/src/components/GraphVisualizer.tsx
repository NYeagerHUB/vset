import React, { useMemo } from 'react';

// Graph JSON Schema Interfaces
export interface GraphAxis {
  label?: string;
  min: number;
  max: number;
  ticks?: number[];
}

export interface GraphCurve {
  type: 'equation' | 'points';
  equation?: string;
  points?: [number, number][];
  label?: string;
  color?: string;
  range?: [number, number];
  dash?: boolean;
}

export interface GraphPoint {
  x: number;
  y: number;
  label?: string;
  showCoordinates?: boolean;
  align?: 'top' | 'bottom' | 'left' | 'right';
}

export interface GraphAnnotation {
  type: 'line' | 'segment' | 'shade' | 'text';
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  text?: string;
  color?: string;
  dash?: boolean;
  range?: [number, number];
  curveIndex?: number;
}

export interface GraphData {
  title?: string;
  xAxis?: GraphAxis;
  yAxis?: GraphAxis;
  curves?: GraphCurve[];
  points?: GraphPoint[];
  annotations?: GraphAnnotation[];
}

interface GraphVisualizerProps {
  graph: GraphData;
}

// Token types for our math parser
type Token =
  | { type: 'NUMBER'; value: number }
  | { type: 'VAR'; name: string }
  | { type: 'FUNC'; name: string }
  | { type: 'PLUS' }
  | { type: 'MINUS' }
  | { type: 'MUL' }
  | { type: 'DIV' }
  | { type: 'POW' }
  | { type: 'LPAREN' }
  | { type: 'RPAREN' }
  | { type: 'COMMA' }
  | { type: 'EOF' };

// Safely tokenize mathematical expressions
function tokenize(str: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < str.length) {
    const char = str[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (char === '+') {
      tokens.push({ type: 'PLUS' });
      i++;
      continue;
    }
    if (char === '-') {
      tokens.push({ type: 'MINUS' });
      i++;
      continue;
    }
    if (char === '*') {
      tokens.push({ type: 'MUL' });
      i++;
      continue;
    }
    if (char === '/') {
      tokens.push({ type: 'DIV' });
      i++;
      continue;
    }
    if (char === '^') {
      tokens.push({ type: 'POW' });
      i++;
      continue;
    }
    if (char === '(') {
      tokens.push({ type: 'LPAREN' });
      i++;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'RPAREN' });
      i++;
      continue;
    }
    if (char === ',') {
      tokens.push({ type: 'COMMA' });
      i++;
      continue;
    }

    // Numbers (integers, floats)
    if (/[0-9.]/.test(char)) {
      let numStr = '';
      while (i < str.length && /[0-9.]/.test(str[i])) {
        numStr += str[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr) });
      continue;
    }

    // Word variables or function names
    if (/[a-zA-Z_]/.test(char)) {
      let word = '';
      while (i < str.length && /[a-zA-Z0-9_]/.test(str[i])) {
        word += str[i];
        i++;
      }

      const lowerWord = word.toLowerCase();
      if (['sin', 'cos', 'tan', 'abs', 'sqrt', 'exp', 'log', 'ln'].includes(lowerWord)) {
        tokens.push({ type: 'FUNC', name: lowerWord });
      } else if (lowerWord === 'x') {
        tokens.push({ type: 'VAR', name: 'x' });
      } else if (lowerWord === 'pi') {
        tokens.push({ type: 'NUMBER', value: Math.PI });
      } else if (lowerWord === 'e') {
        tokens.push({ type: 'NUMBER', value: Math.E });
      } else {
        tokens.push({ type: 'VAR', name: lowerWord });
      }
      continue;
    }

    // Standard failsafe: ignore unknown elements
    i++;
  }

  tokens.push({ type: 'EOF' });

  // Add implicit multiplication: e.g. 2x -> 2*x, x(x+1) -> x*(x+1)
  const expandedTokens: Token[] = [];
  for (let idx = 0; idx < tokens.length; idx++) {
    const current = tokens[idx];
    expandedTokens.push(current);

    if (idx < tokens.length - 1) {
      const next = tokens[idx + 1];
      const isCurrentImplicitFactor =
        current.type === 'NUMBER' ||
        current.type === 'VAR' ||
        current.type === 'RPAREN';
      const isNextImplicitFactor =
        next.type === 'VAR' ||
        next.type === 'FUNC' ||
        next.type === 'LPAREN';

      if (isCurrentImplicitFactor && isNextImplicitFactor) {
        expandedTokens.push({ type: 'MUL' });
      }
    }
  }

  return expandedTokens;
}

// Evaluate token array with a specific 'x' coordinate value
function evaluateTokens(tokens: Token[], xVal: number): number {
  let pos = 0;

  function peek(): Token {
    return tokens[pos] || { type: 'EOF' };
  }

  function consume() {
    pos++;
  }

  function parseExpr(): number {
    let val = parseTerm();
    while (peek().type === 'PLUS' || peek().type === 'MINUS') {
      const type = peek().type;
      consume();
      const nextVal = parseTerm();
      if (type === 'PLUS') {
        val += nextVal;
      } else {
        val -= nextVal;
      }
    }
    return val;
  }

  function parseTerm(): number {
    let val = parsePower();
    while (peek().type === 'MUL' || peek().type === 'DIV') {
      const type = peek().type;
      consume();
      const nextVal = parsePower();
      if (type === 'MUL') {
        val *= nextVal;
      } else {
        if (nextVal === 0) return NaN; // avoid divide-by-zero
        val /= nextVal;
      }
    }
    return val;
  }

  function parsePower(): number {
    let val = parseFactor();
    if (peek().type === 'POW') {
      consume();
      const exponent = parsePower();
      val = Math.pow(val, exponent);
    }
    return val;
  }

  function parseFactor(): number {
    const token = peek();
    if (token.type === 'NUMBER') {
      consume();
      return token.value;
    }
    if (token.type === 'VAR') {
      consume();
      if (token.name === 'x') return xVal;
      return 0; // fallback constants
    }
    if (token.type === 'FUNC') {
      consume();
      if (peek().type !== 'LPAREN') {
        return 0;
      }
      consume(); // consume '('
      const arg = parseExpr();
      if (peek().type === 'RPAREN') {
        consume(); // consume ')'
      }

      switch (token.name) {
        case 'sin': return Math.sin(arg);
        case 'cos': return Math.cos(arg);
        case 'tan': return Math.tan(arg);
        case 'abs': return Math.abs(arg);
        case 'sqrt': return arg < 0 ? NaN : Math.sqrt(arg);
        case 'exp': return Math.exp(arg);
        case 'log':
        case 'ln': return arg <= 0 ? NaN : Math.log(arg);
        default: return 0;
      }
    }
    if (token.type === 'MINUS') {
      consume();
      return -parseFactor();
    }
    if (token.type === 'PLUS') {
      consume();
      return parseFactor();
    }
    if (token.type === 'LPAREN') {
      consume();
      const val = parseExpr();
      if (peek().type === 'RPAREN') {
        consume();
      }
      return val;
    }
    return 0;
  }

  try {
    return parseExpr();
  } catch {
    return NaN;
  }
}

// Evaluator helper
export function evaluateMathFunction(expr: string, x: number): number {
  const processed = expr.replace(/\\/g, ''); // strip escaped sequences
  const tokens = tokenize(processed);
  return evaluateTokens(tokens, x);
}

export const GraphVisualizer: React.FC<GraphVisualizerProps> = ({ graph }) => {
  // SVG limits & padding
  const svgWidth = 500;
  const svgHeight = 350;
  const paddingLeft = 45;
  const paddingRight = 25;
  const paddingTop = 25;
  const paddingBottom = 45;

  // Defaults for Cartesian Coordinates
  const xMin = graph.xAxis?.min !== undefined ? graph.xAxis.min : -10;
  const xMax = graph.xAxis?.max !== undefined ? graph.xAxis.max : 10;
  const yMin = graph.yAxis?.min !== undefined ? graph.yAxis.min : -10;
  const yMax = graph.yAxis?.max !== undefined ? graph.yAxis.max : 10;

  const xAxisLabel = graph.xAxis?.label || 'x';
  const yAxisLabel = graph.yAxis?.label || 'y';

  // Projection factors (linear scale mapping)
  const mapX = (x: number) => {
    const ratio = (x - xMin) / (xMax - xMin);
    return paddingLeft + ratio * (svgWidth - paddingLeft - paddingRight);
  };

  const mapY = (y: number) => {
    const ratio = (y - yMin) / (yMax - yMin);
    // Invert Y axis for screen space
    return svgHeight - paddingBottom - ratio * (svgHeight - paddingTop - paddingBottom);
  };

  // Build grid ticks
  const xTicks = useMemo(() => {
    if (graph.xAxis?.ticks) return graph.xAxis.ticks;
    const ticks = [];
    const step = Math.max(1, Math.round((xMax - xMin) / 10));
    const start = Math.ceil(xMin);
    for (let t = start; t <= xMax; t += step) {
      if (t !== 0) ticks.push(t);
    }
    return ticks;
  }, [graph.xAxis?.ticks, xMin, xMax]);

  const yTicks = useMemo(() => {
    if (graph.yAxis?.ticks) return graph.yAxis.ticks;
    const ticks = [];
    const step = Math.max(1, Math.round((yMax - yMin) / 8));
    const start = Math.ceil(yMin);
    for (let t = start; t <= yMax; t += step) {
      if (t !== 0) ticks.push(t);
    }
    return ticks;
  }, [graph.yAxis?.ticks, yMin, yMax]);

  // Map 0 coordinates
  const originX = mapX(0);
  const originY = mapY(0);

  // Safe checks to clip axes inside bounds
  const yAxisScreenX = Math.max(paddingLeft, Math.min(svgWidth - paddingRight, originX));
  const xAxisScreenY = Math.max(paddingTop, Math.min(svgHeight - paddingBottom, originY));

  // Plot mathematical curves helper
  const drawCurvePath = (curve: GraphCurve) => {
    if (curve.type === 'points' && curve.points) {
      const dParts = curve.points
        .map(([cx, cy], index) => {
          const sx = mapX(cx);
          const sy = mapY(cy);
          if (isNaN(sx) || isNaN(sy)) return '';
          return `${index === 0 ? 'M' : 'L'} ${sx} ${sy}`;
        })
        .filter(Boolean)
        .join(' ');
      return dParts;
    }

    if (curve.type === 'equation' && curve.equation) {
      const steps = 250;
      const cRange = curve.range || [xMin, xMax];
      const stepSize = (cRange[1] - cRange[0]) / steps;
      const pathSegments: string[] = [];
      let isDrawing = false;

      for (let s = 0; s <= steps; s++) {
        const cx = cRange[0] + s * stepSize;
        const cy = evaluateMathFunction(curve.equation, cx);

        if (isNaN(cy) || !isFinite(cy) || cy < yMin - 10 || cy > yMax + 10) {
          isDrawing = false;
          continue;
        }

        const sx = mapX(cx);
        const sy = mapY(cy);

        if (!isDrawing) {
          pathSegments.push(`M ${sx} ${sy}`);
          isDrawing = true;
        } else {
          pathSegments.push(`L ${sx} ${sy}`);
        }
      }
      return pathSegments.join(' ');
    }
    return '';
  };

  // Plot shaded polygon region for integrals
  const drawShadePolygon = (annotation: GraphAnnotation) => {
    if (annotation.type !== 'shade' || !annotation.range) return null;
    const [sX, eX] = annotation.range;
    const curveIdx = annotation.curveIndex !== undefined ? annotation.curveIndex : 0;
    const targetCurve = graph.curves?.[curveIdx];
    if (!targetCurve) return null;

    const steps = 100;
    const stepSize = (eX - sX) / steps;
    const pointsList: string[] = [];

    // Bottom points matching the x-axis
    // Left endpoint on x-axis
    pointsList.push(`${mapX(sX)},${mapY(0)}`);

    // Trace the curve function boundary
    for (let s = 0; s <= steps; s++) {
      const cx = sX + s * stepSize;
      let cy = 0;
      if (targetCurve.type === 'equation' && targetCurve.equation) {
        cy = evaluateMathFunction(targetCurve.equation, cx);
      } else if (targetCurve.type === 'points' && targetCurve.points) {
        // Find piecewise interpolation or nearest
        const sortedPoints = [...targetCurve.points].sort((a, b) => a[0] - b[0]);
        const match = sortedPoints.find(p => p[0] >= cx);
        cy = match ? match[1] : 0;
      }
      if (!isNaN(cy) && isFinite(cy)) {
        pointsList.push(`${mapX(cx)},${mapY(cy)}`);
      }
    }

    // Right endpoint on x-axis
    pointsList.push(`${mapX(eX)},${mapY(0)}`);

    return pointsList.join(' ');
  };

  return (
    <div className="w-full flex flex-col items-center bg-white p-4 rounded-2xl border border-gray-100 shadow-xs">
      {graph.title && (
        <h4 className="text-sm font-semibold text-gray-800 mb-2 font-sans text-center">
          {graph.title}
        </h4>
      )}

      <div className="relative w-full overflow-x-auto flex justify-center">
        <svg
          width={svgWidth}
          height={svgHeight}
          className="bg-[#FAFAFB] rounded-xl border border-gray-100/50 flex-shrink-0"
        >
          {/* DEFINITIONS FOR SHADOWS/ARROWS */}
          <defs>
            <marker
              id="arrow-head"
              viewBox="0 0 10 10"
              refX="10"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#4B5563" />
            </marker>
          </defs>

          {/* GRID BOUNDS */}
          <rect
            x={paddingLeft}
            y={paddingTop}
            width={svgWidth - paddingLeft - paddingRight}
            height={svgHeight - paddingTop - paddingBottom}
            fill="#FFFFFF"
          />

          {/* BACKGROUND FAINT GRID LINES */}
          <g stroke="#E5E7EB" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.8">
            {xTicks.map(t => {
              const sx = mapX(t);
              return <line key={`gx-${t}`} x1={sx} y1={paddingTop} x2={sx} y2={svgHeight - paddingBottom} />;
            })}
            {yTicks.map(t => {
              const sy = mapY(t);
              return <line key={`gy-${t}`} x1={paddingLeft} y1={sy} x2={svgWidth - paddingRight} y2={sy} />;
            })}
          </g>

          {/* SHADED INTEGRAL REGIONS */}
          {graph.annotations?.map((annotation, idx) => {
            if (annotation.type === 'shade') {
              const shadePath = drawShadePolygon(annotation);
              if (!shadePath) return null;
              return (
                <polygon
                  key={`shade-${idx}`}
                  points={shadePath}
                  fill={annotation.color || 'rgba(99, 102, 241, 0.15)'}
                  stroke={annotation.color || 'rgba(99, 102, 241, 0.3)'}
                  strokeWidth="1"
                  className="animate-pulse"
                />
              );
            }
            return null;
          })}

          {/* COORDINATE AXES (x & y) */}
          <g stroke="#4B5563" strokeWidth="1.5">
            {/* X Axis */}
            <line
              x1={paddingLeft - 10}
              y1={xAxisScreenY}
              x2={svgWidth - paddingRight + 12}
              y2={xAxisScreenY}
              markerEnd="url(#arrow-head)"
            />
            {/* Y Axis */}
            <line
              x1={yAxisScreenX}
              y1={svgHeight - paddingBottom + 10}
              x2={yAxisScreenX}
              y2={paddingTop - 12}
              markerEnd="url(#arrow-head)"
            />
          </g>

          {/* AXES LABELS */}
          <text
            x={svgWidth - paddingRight + 17}
            y={xAxisScreenY + 4}
            fill="#1F2937"
            fontSize="12"
            fontWeight="bold"
            fontFamily="monospace"
            textAnchor="start"
          >
            {xAxisLabel}
          </text>
          <text
            x={yAxisScreenX}
            y={paddingTop - 18}
            fill="#1F2937"
            fontSize="12"
            fontWeight="bold"
            fontFamily="monospace"
            textAnchor="middle"
          >
            {yAxisLabel}
          </text>

          {/* TICKS AND LABELS ON AXES */}
          {/* Origin O */}
          {xMin < 0 && xMax > 0 && yMin < 0 && yMax > 0 && (
            <text
              x={originX - 9}
              y={originY + 14}
              fill="#4B5563"
              fontSize="11"
              fontFamily="sans-serif"
              textAnchor="middle"
            >
              O
            </text>
          )}

          {/* X Ticks */}
          {xTicks.map(t => {
            const sx = mapX(t);
            // Don't draw near origin to prevent overlaps
            if (Math.abs(sx - originX) < 12) return null;
            return (
              <g key={`xtick-${t}`} className="text-[10px] fill-gray-600 font-sans">
                <line x1={sx} y1={xAxisScreenY - 3} x2={sx} y2={xAxisScreenY + 3} stroke="#4B5563" strokeWidth="1" />
                <text x={sx} y={xAxisScreenY + 14} textAnchor="middle">
                  {t}
                </text>
              </g>
            );
          })}

          {/* Y Ticks */}
          {yTicks.map(t => {
            const sy = mapY(t);
            // Don't draw near origin to prevent overlaps
            if (Math.abs(sy - originY) < 12) return null;
            return (
              <g key={`ytick-${t}`} className="text-[10px] fill-gray-600 font-sans">
                <line x1={yAxisScreenX - 3} y1={sy} x2={yAxisScreenX + 3} y2={sy} stroke="#4B5563" strokeWidth="1" />
                <text x={yAxisScreenX - 7} y={sy + 3} textAnchor="end">
                  {t}
                </text>
              </g>
            );
          })}

          {/* MATHEMATICAL FUNCTIONS AND CURVES */}
          {graph.curves?.map((curve, idx) => {
            const dStr = drawCurvePath(curve);
            if (!dStr) return null;
            return (
              <path
                key={`curve-${idx}`}
                d={dStr}
                fill="none"
                stroke={curve.color || '#4338CA'}
                strokeWidth="2.2"
                strokeDasharray={curve.dash ? '4 4' : undefined}
                className="transition-all duration-300"
              />
            );
          })}

          {/* CUSTOM ANNOTATIONS (segments, projection lines, custom text) */}
          {graph.annotations?.map((annotation, idx) => {
            if (annotation.type === 'segment' && annotation.x1 !== undefined && annotation.y1 !== undefined && annotation.x2 !== undefined && annotation.y2 !== undefined) {
              const sx1 = mapX(annotation.x1);
              const sy1 = mapY(annotation.y1);
              const sx2 = mapX(annotation.x2);
              const sy2 = mapY(annotation.y2);
              return (
                <line
                  key={`segment-${idx}`}
                  x1={sx1}
                  y1={sy1}
                  x2={sx2}
                  y2={sy2}
                  stroke={annotation.color || '#9CA3AF'}
                  strokeWidth="1.2"
                  strokeDasharray={annotation.dash ? '3 3' : undefined}
                />
              );
            }

            if (annotation.type === 'text' && annotation.x1 !== undefined && annotation.y1 !== undefined && annotation.text) {
              const sx = mapX(annotation.x1);
              const sy = mapY(annotation.y1);
              return (
                <text
                  key={`text-ann-${idx}`}
                  x={sx}
                  y={sy}
                  fill={annotation.color || '#374151'}
                  fontSize="10"
                  fontFamily="sans-serif"
                  fontWeight="medium"
                  textAnchor="middle"
                >
                  {annotation.text}
                </text>
              );
            }
            return null;
          })}

          {/* DOT POINTS WITH COORDINATES AND LABELS */}
          {graph.points?.map((pt, idx) => {
            const sx = mapX(pt.x);
            const sy = mapY(pt.y);
            if (isNaN(sx) || isNaN(sy)) return null;

            // Offset alignment for text
            let textDx = 0;
            let textDy = 0;
            let anchor: 'start' | 'end' | 'middle' = 'middle';

            switch (pt.align) {
              case 'top':
                textDy = -8;
                break;
              case 'bottom':
                textDy = 12;
                break;
              case 'left':
                textDx = -8;
                anchor = 'end';
                textDy = 3;
                break;
              case 'right':
                textDx = 8;
                anchor = 'start';
                textDy = 3;
                break;
              default:
                textDy = -8;
            }

            return (
              <g key={`pt-${idx}`}>
                <circle cx={sx} cy={sy} r="4" fill="#EF4444" stroke="#FFFFFF" strokeWidth="1.5" />
                {(pt.label || pt.showCoordinates) && (
                  <text
                    x={sx + textDx}
                    y={sy + textDy}
                    fill="#1F2937"
                    fontSize="10"
                    fontWeight="600"
                    fontFamily="sans-serif"
                    textAnchor={anchor}
                  >
                    {pt.label ? pt.label : ''}
                    {pt.showCoordinates ? `(${pt.x}, ${pt.y})` : ''}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* GRAPH LEGEND IF LABELS ARE PROVIDED */}
      {graph.curves?.some(c => c.label) && (
        <div className="flex flex-wrap gap-4 mt-2 justify-center">
          {graph.curves
            .filter(c => c.label)
            .map((curve, idx) => (
              <div key={`legend-${idx}`} className="flex items-center gap-1.5 text-xs text-gray-600 font-medium">
                <span
                  className="w-4 h-0.5 inline-block"
                  style={{
                    backgroundColor: curve.color || '#4338CA',
                    borderTop: curve.dash ? '1px dashed' : 'none',
                  }}
                />
                <span>{curve.label}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};
