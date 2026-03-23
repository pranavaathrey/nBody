import {
  Color3,
  Effect,
  Mesh,
  MeshBuilder,
  Scene,
  ShaderMaterial,
  Vector3
} from '@babylonjs/core';
import {
  WORLD_GRID_FADE_RANGE,
  WORLD_GRID_FADE_START_DISTANCE,
  WORLD_GRID_HALF_SPAN,
  WORLD_GRID_MAJOR_PIXEL_WIDTH,
  WORLD_GRID_MAJOR_SPACING,
  WORLD_GRID_MINOR_PIXEL_WIDTH,
  WORLD_GRID_MINOR_SPACING,
  WORLD_GRID_OPACITY
} from '../../lib/config';
import { clamp01 } from './math';

export type WorldGridRenderer = {
  update: (cameraPos: Vector3) => void;
  setVisible: (visible: boolean) => void;
  dispose: () => void;
};

function finiteOrFallback(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

const WORLD_GRID_SHADER_NAME = 'nbodyWorldGrid';

const WORLD_GRID_VERTEX_SHADER = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
uniform mat4 world;
varying vec3 vWorldPos;

void main(void) {
  vec4 worldPos = world * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const WORLD_GRID_FRAGMENT_SHADER = `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;
varying vec3 vWorldPos;
uniform float minorSpacing;
uniform float majorSpacing;
uniform float minorPixelWidth;
uniform float majorPixelWidth;
uniform float opacity;
uniform float fadeStartDistance;
uniform float fadeRange;
uniform vec3 cameraWorldPos;
uniform vec3 minorColor;
uniform vec3 majorColor;

float lineMask(vec2 worldXY, float spacing, float pixelWidth) {
  vec2 cell = worldXY / spacing;
  vec2 deriv = max(fwidth(cell), vec2(1e-5));
  vec2 local = abs(fract(cell - 0.5) - 0.5) / deriv;
  float dist = min(local.x, local.y);
  float halfWidth = max(pixelWidth * 0.5, 0.5);
  return 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, dist);
}

void main(void) {
  vec2 worldXY = vWorldPos.xy;
  float major = lineMask(worldXY, majorSpacing, majorPixelWidth);
  float minor = lineMask(worldXY, minorSpacing, minorPixelWidth) * (1.0 - major);
  float coverage = max(minor, major);
  float cameraDistance = length(vWorldPos - cameraWorldPos);
  float distanceFade = 1.0 - smoothstep(
    fadeStartDistance,
    fadeStartDistance + fadeRange,
    cameraDistance
  );
  float alpha = opacity * coverage * distanceFade;
  if (alpha <= 0.001) {
    discard;
  }

  vec3 color = minorColor * minor + majorColor * major;
  gl_FragColor = vec4(color, alpha);
}
`;

export function createWorldGridRenderer(scene: Scene): WorldGridRenderer {
  const minorSpacing = Math.max(1e-3, Math.abs(finiteOrFallback(WORLD_GRID_MINOR_SPACING, 100)));
  const majorSpacing = Math.max(
    minorSpacing,
    Math.abs(finiteOrFallback(WORLD_GRID_MAJOR_SPACING, 1000))
  );
  const halfSpan = Math.max(minorSpacing, Math.abs(finiteOrFallback(WORLD_GRID_HALF_SPAN, 10000)));
  const minorPixelWidth = Math.max(
    0.5,
    Math.abs(finiteOrFallback(WORLD_GRID_MINOR_PIXEL_WIDTH, 1))
  );
  const majorPixelWidth = Math.max(
    minorPixelWidth,
    Math.abs(finiteOrFallback(WORLD_GRID_MAJOR_PIXEL_WIDTH, 2.4))
  );
  const opacity = clamp01(finiteOrFallback(WORLD_GRID_OPACITY, 0.3));
  const fadeStartDistance = Math.max(
    0,
    Math.abs(finiteOrFallback(WORLD_GRID_FADE_START_DISTANCE, 2000))
  );
  const fadeRange = Math.max(1e-3, Math.abs(finiteOrFallback(WORLD_GRID_FADE_RANGE, 1500)));

  Effect.ShadersStore[`${WORLD_GRID_SHADER_NAME}VertexShader`] = WORLD_GRID_VERTEX_SHADER;
  Effect.ShadersStore[`${WORLD_GRID_SHADER_NAME}FragmentShader`] = WORLD_GRID_FRAGMENT_SHADER;

  const material = new ShaderMaterial(
    'world-grid-mat',
    scene,
    {
      vertex: WORLD_GRID_SHADER_NAME,
      fragment: WORLD_GRID_SHADER_NAME
    },
    {
      attributes: ['position'],
      uniforms: [
        'world',
        'worldViewProjection',
        'minorSpacing',
        'majorSpacing',
        'minorPixelWidth',
        'majorPixelWidth',
        'opacity',
        'fadeStartDistance',
        'fadeRange',
        'cameraWorldPos',
        'minorColor',
        'majorColor'
      ],
      needAlphaBlending: true
    }
  );
  material.backFaceCulling = false;

  material.setFloat('minorSpacing', minorSpacing);
  material.setFloat('majorSpacing', majorSpacing);
  material.setFloat('minorPixelWidth', minorPixelWidth);
  material.setFloat('majorPixelWidth', majorPixelWidth);
  material.setFloat('opacity', opacity);
  material.setFloat('fadeStartDistance', fadeStartDistance);
  material.setFloat('fadeRange', fadeRange);
  material.setVector3('cameraWorldPos', new Vector3(0, 0, 0));
  material.setColor3('minorColor', new Color3(0.15, 0.2, 0.26));
  material.setColor3('majorColor', new Color3(0.22, 0.3, 0.38));

  const gridPlane = MeshBuilder.CreatePlane(
    'world-grid',
    {
      width: halfSpan * 2,
      height: halfSpan * 2,
      sideOrientation: Mesh.DOUBLESIDE
    },
    scene
  );
  gridPlane.material = material;
  gridPlane.isPickable = false;
  gridPlane.alwaysSelectAsActiveMesh = true;

  let visible = true;

  const setVisible = (nextVisible: boolean) => {
    visible = nextVisible;
    gridPlane.setEnabled(nextVisible);
  };

  const update = (cameraPos: Vector3) => {
    if (!visible) return;
    material.setVector3('cameraWorldPos', cameraPos);
    gridPlane.position.x = cameraPos.x;
    gridPlane.position.y = cameraPos.y;
  };

  const dispose = () => {
    gridPlane.dispose(false, true);
  };

  return {
    update,
    setVisible,
    dispose
  };
}
