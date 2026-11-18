/**
 * Configuración por ejercicio. Cada ejercicio usa EXCLUSIVAMENTE su variable de velocidad:
 *  - Sentadilla profunda y press de banca: VMP (velocidad media propulsiva).
 *  - Remo tumbado: VMAX (velocidad máxima).
 */
export type ExerciseKey = 'squat' | 'bench' | 'row';
export type VelocityVariable = 'VMP' | 'VMAX';
export type TestKey = 'pre' | 'post';

export interface ExerciseConfig {
  key: ExerciseKey;
  name: string;
  slug: string;
  velocityVariable: VelocityVariable;
  velocityName: string;
  /** V1RM por defecto (m/s). null = sin valor por defecto validado. */
  defaultV1rm: number | null;
  /** Fuente mostrada bajo el campo V1RM (modelo lineal) o 1RM medido (modelo polinómico). */
  v1rmSource: string;
  /**
   * Modelo de la curva carga-velocidad individual:
   *  - 'linear': V = a + b·Carga; 1RM estimado con la V1RM.
   *  - 'poly2':  V = c0 + c1·%1RM + c2·%1RM², con 1RM medido (Espinosa-Retamal et al., 2026).
   */
  model: 'linear' | 'poly2';
}

export const EXERCISE_KEYS: ExerciseKey[] = ['squat', 'bench', 'row'];
export const TEST_KEYS: TestKey[] = ['pre', 'post'];

export const EXERCISES: Record<ExerciseKey, ExerciseConfig> = {
  squat: {
    key: 'squat',
    name: 'Sentadilla profunda',
    slug: 'sentadilla-profunda',
    velocityVariable: 'VMP',
    velocityName: 'velocidad media propulsiva (VMP)',
    defaultV1rm: 0.32,
    v1rmSource:
      'Valor por defecto 0,32 m/s: velocidad media en el 1RM de 0,32 ± 0,03 m/s (Sánchez-Medina et al., 2017).',
    model: 'linear',
  },
  bench: {
    key: 'bench',
    name: 'Press de banca',
    slug: 'press-de-banca',
    velocityVariable: 'VMP',
    velocityName: 'velocidad media propulsiva (VMP)',
    defaultV1rm: 0.16,
    v1rmSource:
      'Valor por defecto 0,16 m/s: velocidad media en el 1RM de 0,16 ± 0,04 m/s (González-Badillo y Sánchez-Medina, 2010).',
    model: 'linear',
  },
  row: {
    key: 'row',
    name: 'Remo tumbado',
    slug: 'remo-tumbado',
    velocityVariable: 'VMAX',
    velocityName: 'velocidad máxima (VMAX)',
    defaultV1rm: null,
    v1rmSource:
      'Método de Espinosa-Retamal, …, González-Badillo y Rodríguez-Rosell (2026, J Funct Morphol Kinesiol 11:429): relación individual %1RM–VMAX ajustada con un polinomio de 2.º grado y 1RM determinado directamente (carga más alta levantada con recorrido completo). Incluye la repetición del 1RM como un par más de la tabla.',
    model: 'poly2',
  },
};

export function isExerciseKey(v: unknown): v is ExerciseKey {
  return typeof v === 'string' && (EXERCISE_KEYS as string[]).includes(v);
}

export function isTestKey(v: unknown): v is TestKey {
  return typeof v === 'string' && (TEST_KEYS as string[]).includes(v);
}

export function exerciseFromSlug(slug: string | undefined): ExerciseConfig | undefined {
  return EXERCISE_KEYS.map((k) => EXERCISES[k]).find((e) => e.slug === slug);
}
