import 'chart.js/auto';
import type { Plugin } from 'chart.js';
import { Chart } from 'react-chartjs-2';
import type { ChartCurve } from '../model.ts';
import { fmt, fmtSigned } from '../format.ts';

const INK = '#14171f';
const ACCENT = '#1f5eff';
const POS = 'rgba(18,148,90,.8)';
const NEG = 'rgba(210,60,60,.8)';
const FONT = { family: 'Inter, system-ui, sans-serif' };

/* ---------- Curva carga-velocidad ---------- */
const PRE_GREY = '#9aa3ad';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function curveDatasets(c: ChartCurve, prefix: string, style: 'main' | 'reference'): any[] {
  const main = style === 'main';
  const pointColor = main ? ACCENT : PRE_GREY;
  const lineColor = main ? INK : PRE_GREY;
  const name = (s: string) => (prefix ? `${prefix}: ${s}` : cap(s));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ds: any[] = [
    {
      type: 'scatter',
      label: name('datos registrados'),
      data: c.points.map((pt) => ({ x: pt.load, y: pt.velocity })),
      backgroundColor: main ? pointColor : '#ffffff',
      borderColor: pointColor,
      borderWidth: main ? 0 : 2,
      pointRadius: 5,
      order: main ? 1 : 4,
    },
  ];
  if (c.line) {
    ds.push({
      type: 'line',
      label: name(c.lineLabel),
      data: c.line,
      borderColor: lineColor,
      borderWidth: main ? 1.5 : 2,
      borderDash: main ? [5, 4] : [2, 3],
      pointRadius: 0,
      pointHitRadius: 0,
      tension: 0,
      order: main ? 2 : 5,
    });
  }
  if (c.marker) {
    ds.push({
      type: 'scatter',
      label: name(c.marker.label),
      data: [{ x: c.marker.x, y: c.marker.y }],
      backgroundColor: main ? INK : '#ffffff',
      borderColor: lineColor,
      borderWidth: main ? 0 : 2,
      pointStyle: 'rectRot',
      pointRadius: 8,
      order: main ? 0 : 3,
    });
  }
  return ds;
}

/**
 * Gráfico carga-velocidad. Con `reference` (pre-test) superpone esa curva en gris para compararla
 * con la del test actual (post-test). Cada curva se calcula solo con los datos de su propio test.
 */
export function LoadVelocityChart({
  curve,
  vt,
  label,
  reference,
}: {
  curve: ChartCurve;
  vt: string;
  label?: string;
  reference?: ChartCurve & { label: string };
}) {
  const datasets = [
    ...curveDatasets(curve, reference ? (label ?? '') : '', 'main'),
    ...(reference ? curveDatasets(reference, reference.label, 'reference') : []),
  ];
  return (
    <Chart
      type="scatter"
      data={{ datasets }}
      options={{
        maintainAspectRatio: false,
        animation: false,
        scales: {
          x: { type: 'linear', min: 0, title: { display: true, text: 'Carga (kg)', font: FONT } },
          y: { beginAtZero: true, title: { display: true, text: `${vt} (m/s)`, font: FONT } },
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: FONT, sort: (a, b) => (a.datasetIndex ?? 0) - (b.datasetIndex ?? 0) } },
          tooltip: {
            callbacks: {
              label: (c) => `${c.dataset.label}: ${fmt(c.parsed.x, 1)} kg · ${fmt(c.parsed.y, 2)} m/s (${vt})`,
            },
          },
        },
      }}
    />
  );
}

/* ---------- Evolución de la diferencia ---------- */
export interface TrackingPoint {
  label: string;
  load: number | null;
  vel: number | null;
  ref: number | null;
  diff: number | null;
  /** Diferencia relativa (%) = diff / ref · 100. */
  pct: number | null;
}

const zeroLine: Plugin<'bar'> = {
  id: 'zeroLine',
  afterDatasetsDraw(chart) {
    const y = chart.scales.y;
    if (!y) return;
    const py = y.getPixelForValue(0);
    if (py < y.top || py > y.bottom) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(chartArea.left, py);
    ctx.lineTo(chartArea.right, py);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('0 = referencia pre-test', chartArea.right - 4, py - 5);
    ctx.restore();
  },
};

/** Con `relative` se representan las diferencias en % respecto a la referencia del pre-test. */
export function TrackingChart({ points, vt, relative = false }: { points: TrackingPoint[]; vt: string; relative?: boolean }) {
  const diffs = points.map((p) => (relative ? p.pct : p.diff));
  const unit = relative ? '%' : 'm/s';
  return (
    <Chart
      type="bar"
      plugins={[zeroLine]}
      data={{
        labels: points.map((p) => p.label),
        datasets: [
          {
            type: 'line' as const,
            label: 'Tendencia',
            data: diffs,
            borderColor: INK,
            borderWidth: 1.5,
            pointRadius: 3,
            pointBackgroundColor: INK,
            spanGaps: true,
            order: 0,
          },
          {
            type: 'bar' as const,
            label: `Diferencia de ${vt} (${unit})`,
            data: diffs,
            backgroundColor: diffs.map((d) => (d != null && d >= 0 ? POS : NEG)),
            borderRadius: 4,
            order: 1,
          },
        ],
      }}
      options={{
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { title: { display: true, text: 'Sesión (orden de registro)', font: FONT } },
          y: { beginAtZero: true, title: { display: true, text: `Diferencia de ${vt} (${unit})`, font: FONT } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item) => item.datasetIndex === 1,
            callbacks: {
              label: (c) => {
                const p = points[c.dataIndex];
                return [
                  `Carga: ${fmt(p.load, 1)} kg`,
                  `${vt} 1.ª repetición: ${fmt(p.vel, 2)} m/s`,
                  `${vt} referencia pre-test: ${fmt(p.ref, 3)} m/s`,
                  `Diferencia: ${fmtSigned(p.diff, 3)} m/s (${fmtSigned(p.pct, 1)} %)`,
                ];
              },
            },
          },
        },
      }}
    />
  );
}
