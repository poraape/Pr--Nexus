import React from 'react';
import type { ChartData } from '../types';

type EmptyStateProps = {
  message?: string;
};

const COLOR_PALETTE = [
  '#38bdf8',
  '#34d399',
  '#f87171',
  '#fbbf24',
  '#a78bfa',
  '#f472b6',
  '#60a5fa',
  '#818cf8',
  '#a3e635',
  '#2dd4bf',
];

const EmptyState: React.FC<EmptyStateProps> = ({ message }) => (
  <div className="border border-dashed border-gray-600 bg-gray-800/40 rounded-lg p-6 text-center text-sm text-gray-400">
    {message ?? 'Sem dados suficientes para exibir o grafico.'}
  </div>
);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const Chart: React.FC<ChartData> = ({ type, title, data, options, xAxisLabel, yAxisLabel }) => {
  const safeData = Array.isArray(data)
    ? data.filter(point => point && typeof point.value === 'number' && Number.isFinite(point.value))
    : [];
  const allZeros = safeData.every(point => point.value === 0);

  const chartHeight = 200;
  const chartWidth = 320;
  const padding = { top: 16, right: 16, bottom: 32, left: 40 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  const renderBarChart = () => {
    if (safeData.length === 0) {
      return <EmptyState />;
    }
    const maxValue = Math.max(...safeData.map(item => item.value));
    if (maxValue === 0) {
      return <EmptyState message="Todos os valores desta metrica estao zerados no filtro atual." />;
    }
    const barWidth = plotWidth / safeData.length;
    return (
      <svg
        width="100%"
        height={chartHeight + 40}
        viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`}
        role="img"
        aria-label={`Grafico de barras: ${title}`}
      >
        {yAxisLabel && (
          <text
            x={-(chartHeight / 2)}
            y={12}
            transform="rotate(-90)"
            textAnchor="middle"
            fontSize="10"
            fill="#9ca3af"
          >
            {yAxisLabel}
          </text>
        )}
        <line
          x1={padding.left}
          y1={padding.top + plotHeight}
          x2={chartWidth - padding.right}
          y2={padding.top + plotHeight}
          stroke="#4b5563"
        />
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={padding.top + plotHeight}
          stroke="#4b5563"
        />
        {safeData.map((item, index) => {
          const height = (item.value / maxValue) * plotHeight;
          const x = padding.left + index * barWidth + barWidth * 0.1;
          const y = padding.top + plotHeight - height;
          return (
            <g key={index}>
              <rect
                x={x}
                y={y}
                width={barWidth * 0.8}
                height={height}
                fill={item.color || COLOR_PALETTE[index % COLOR_PALETTE.length]}
              />
              <text
                x={padding.left + index * barWidth + barWidth / 2}
                y={chartHeight + 20}
                fontSize="10"
                fill="#9ca3af"
                textAnchor="middle"
              >
                {item.label ?? `Item ${index + 1}`}
              </text>
            </g>
          );
        })}
        {xAxisLabel && (
          <text x={chartWidth / 2} y={chartHeight + 36} textAnchor="middle" fontSize="10" fill="#9ca3af">
            {xAxisLabel}
          </text>
        )}
      </svg>
    );
  };

  const renderPieChart = () => {
    if (safeData.length === 0) {
      return <EmptyState />;
    }
    const total = safeData.reduce((sum, item) => sum + Math.max(item.value, 0), 0);
    if (total === 0) {
      return <EmptyState message="Todos os valores desta metrica estao zerados no filtro atual." />;
    }
    let cumulative = 0;
    const radius = Math.min(chartWidth, chartHeight) / 2 - 12;
    const centerX = chartWidth / 2;
    const centerY = chartHeight / 2 + 8;

    const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
      const angleRad = ((angleDeg - 90) * Math.PI) / 180;
      return {
        x: cx + r * Math.cos(angleRad),
        y: cy + r * Math.sin(angleRad),
      };
    };

    return (
      <svg width="100%" height={chartHeight + 40} viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`} role="img" aria-label={`Grafico de pizza: ${title}`}>
        {safeData.map((item, index) => {
          const value = Math.max(item.value, 0);
          const angle = (value / total) * 360;
          const start = polarToCartesian(centerX, centerY, radius, cumulative);
          cumulative += angle;
          const end = polarToCartesian(centerX, centerY, radius, cumulative);
          const largeArc = angle > 180 ? 1 : 0;
          const pathData = [
            `M ${centerX} ${centerY}`,
            `L ${start.x} ${start.y}`,
            `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`,
            'Z',
          ].join(' ');
          return (
            <path
              key={index}
              d={pathData}
              fill={item.color || COLOR_PALETTE[index % COLOR_PALETTE.length]}
              stroke="#111827"
              strokeWidth={1}
            />
          );
        })}
      </svg>
    );
  };

  const renderLineChart = () => {
    if (safeData.length < 2) {
      return <EmptyState message="Dados insuficientes para grafico de linha." />;
    }
    const maxValue = Math.max(...safeData.map(item => item.value));
    const minValue = Math.min(...safeData.map(item => item.value));
    const range = maxValue - minValue || 1;
    const pathData = safeData
      .map((item, index) => {
        const x = padding.left + (index / (safeData.length - 1)) * plotWidth;
        const y = padding.top + plotHeight - ((item.value - minValue) / range) * plotHeight;
        return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .join(' ');

    return (
      <svg
        width="100%"
        height={chartHeight + 40}
        viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`}
        role="img"
        aria-label={`Grafico de linha: ${title}`}
      >
        {yAxisLabel && (
          <text
            x={-(chartHeight / 2)}
            y={12}
            transform="rotate(-90)"
            textAnchor="middle"
            fontSize="10"
            fill="#9ca3af"
          >
            {yAxisLabel}
          </text>
        )}
        <line
          x1={padding.left}
          y1={padding.top + plotHeight}
          x2={chartWidth - padding.right}
          y2={padding.top + plotHeight}
          stroke="#4b5563"
        />
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={padding.top + plotHeight}
          stroke="#4b5563"
        />
        <path d={pathData} fill="none" stroke={COLOR_PALETTE[0]} strokeWidth={2} />
        {safeData.map((item, index) => {
          const x = padding.left + (index / (safeData.length - 1)) * plotWidth;
          const y = padding.top + plotHeight - ((item.value - minValue) / range) * plotHeight;
          return <circle key={index} cx={x} cy={y} r={3} fill={COLOR_PALETTE[0]} />;
        })}
        {xAxisLabel && (
          <text x={chartWidth / 2} y={chartHeight + 36} textAnchor="middle" fontSize="10" fill="#9ca3af">
            {xAxisLabel}
          </text>
        )}
      </svg>
    );
  };

  const renderScatterChart = () => {
    if (safeData.length === 0) {
      return <EmptyState />;
    }
    const xValues = safeData.map(item => item.x ?? 0);
    const yValues = safeData.map(item => item.value);
    const maxX = Math.max(...xValues);
    const minX = Math.min(...xValues);
    const maxY = Math.max(...yValues);
    const minY = Math.min(...yValues);
    const xRange = maxX - minX || 1;
    const yRange = maxY - minY || 1;

    return (
      <svg
        width="100%"
        height={chartHeight + 40}
        viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`}
        role="img"
        aria-label={`Grafico de dispersao: ${title}`}
      >
        {yAxisLabel && (
          <text
            x={-(chartHeight / 2)}
            y={12}
            transform="rotate(-90)"
            textAnchor="middle"
            fontSize="10"
            fill="#9ca3af"
          >
            {yAxisLabel}
          </text>
        )}
        <line
          x1={padding.left}
          y1={padding.top + plotHeight}
          x2={chartWidth - padding.right}
          y2={padding.top + plotHeight}
          stroke="#4b5563"
        />
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={padding.top + plotHeight}
          stroke="#4b5563"
        />
        {safeData.map((item, index) => {
          const cx = padding.left + ((item.x ?? 0) - minX) / xRange * plotWidth;
          const cy = padding.top + plotHeight - ((item.value - minY) / yRange) * plotHeight;
          return (
            <circle
              key={index}
              cx={clamp(cx, padding.left, chartWidth - padding.right)}
              cy={clamp(cy, padding.top, padding.top + plotHeight)}
              r={3}
              fill={item.color || COLOR_PALETTE[index % COLOR_PALETTE.length]}
            />
          );
        })}
        {xAxisLabel && (
          <text x={chartWidth / 2} y={chartHeight + 36} textAnchor="middle" fontSize="10" fill="#9ca3af">
            {xAxisLabel}
          </text>
        )}
      </svg>
    );
  };

  const renderChartBody = () => {
    switch (type) {
      case 'bar':
        return renderBarChart();
      case 'pie':
        return renderPieChart();
      case 'line':
        return renderLineChart();
      case 'scatter':
        return renderScatterChart();
      default:
        return <EmptyState message={`Tipo de grafico desconhecido: ${type}.`} />;
    }
  };

  if (safeData.length === 0) {
    return (
      <div>
        <h4 className="text-md font-semibold text-gray-300 mb-2 text-center">{title}</h4>
        <EmptyState />
      </div>
    );
  }

  if (allZeros && type !== 'pie') {
    return (
      <div>
        <h4 className="text-md font-semibold text-gray-300 mb-2 text-center">{title}</h4>
        <EmptyState message="Todos os valores desta metrica estao zerados no filtro atual." />
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-md font-semibold text-gray-300 mb-2 text-center">{title}</h4>
      {renderChartBody()}
    </div>
  );
};

export default Chart;
