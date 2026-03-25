/**
 * GLSL shader sources for the gregblur pipeline.
 *
 * All shaders target WebGL2 (GLSL ES 3.00). The pipeline uses a fullscreen
 * quad (-1..1 NDC) with texture coordinates derived in the vertex shader.
 */

// ─── Vertex shaders ──────────────────────────────────────────────────────────

/** Vertex shader that flips Y for camera-frame orientation. */
export const VERTEX_SHADER = `#version 300 es
in vec2 position;
out vec2 texCoords;
void main() {
  texCoords = (position + 1.0) / 2.0;
  texCoords.y = 1.0 - texCoords.y;
  gl_Position = vec4(position, 0, 1.0);
}
`

/** Vertex shader without Y-flip for render-target textures. */
export const VERTEX_SHADER_NO_FLIP = `#version 300 es
in vec2 position;
out vec2 texCoords;
void main() {
  texCoords = (position + 1.0) / 2.0;
  gl_Position = vec4(position, 0, 1.0);
}
`

// ─── Fragment shaders ────────────────────────────────────────────────────────

/**
 * Joint bilateral filter: refines the raw confidence mask using the original
 * frame's color as a guide. Smooths the mask where the image is uniform but
 * preserves sharp transitions where actual edges exist (glasses, hair, etc.).
 * Also inverts the mask: background confidence → foreground confidence.
 */
export const BILATERAL_FILTER_SHADER = `#version 300 es
precision mediump float;
in vec2 texCoords;
uniform sampler2D u_mask;        // raw confidence mask (bg confidence: 1.0=background, 0.0=person)
uniform sampler2D u_guideFrame;  // original frame (color guide)
uniform vec2 u_texelSize;
uniform float u_sigmaSpace;
uniform float u_sigmaColor;
out vec4 fragColor;

void main() {
  vec3 centerColor = texture(u_guideFrame, texCoords).rgb;
  float centerMask = 1.0 - texture(u_mask, texCoords).r; // invert to foreground

  float totalWeight = 0.0;
  float result = 0.0;

  const int RADIUS = 5;

  for (int dy = -RADIUS; dy <= RADIUS; dy++) {
    for (int dx = -RADIUS; dx <= RADIUS; dx++) {
      vec2 offset = vec2(float(dx), float(dy)) * u_texelSize;
      vec2 sampleCoord = texCoords + offset;

      vec3 sampleColor = texture(u_guideFrame, sampleCoord).rgb;
      float sampleMask = 1.0 - texture(u_mask, sampleCoord).r;

      // Spatial weight: closer pixels contribute more
      float spatialDist = length(vec2(float(dx), float(dy)));
      float spaceW = exp(-(spatialDist * spatialDist) / (2.0 * u_sigmaSpace * u_sigmaSpace));

      // Color weight: pixels with similar color contribute more
      // This is what makes edges sharp — dissimilar colors get low weight
      float colorDist = length(centerColor - sampleColor);
      float colorW = exp(-(colorDist * colorDist) / (2.0 * u_sigmaColor * u_sigmaColor));

      float w = spaceW * colorW;
      result += sampleMask * w;
      totalWeight += w;
    }
  }

  float refined = result / max(totalWeight, 0.001);
  fragColor = vec4(refined, refined, refined, 1.0);
}
`

/** Temporal smoothing: blend current mask with previous frame's mask to reduce flicker. */
export const TEMPORAL_BLEND_SHADER = `#version 300 es
precision mediump float;
in vec2 texCoords;
uniform sampler2D u_currentMask;
uniform sampler2D u_previousMask;
uniform float u_blendFactor;
out vec4 fragColor;
void main() {
  float current = texture(u_currentMask, texCoords).r;
  float previous = texture(u_previousMask, texCoords).r;
  float blended = mix(current, previous, u_blendFactor);
  fragColor = vec4(blended, blended, blended, 1.0);
}
`

/** Simple copy/passthrough shader for copying textures between FBOs. */
export const COPY_SHADER = `#version 300 es
precision mediump float;
in vec2 texCoords;
uniform sampler2D u_texture;
out vec4 fragColor;
void main() {
  fragColor = texture(u_texture, texCoords);
}
`

/**
 * Downsample the source frame into the background-blur buffer while using the
 * foreground mask to avoid baking the subject into low-resolution texels.
 */
export const MASKED_DOWNSAMPLE_SHADER = `#version 300 es
precision mediump float;
in vec2 texCoords;
uniform sampler2D u_texture;
uniform sampler2D u_mask;
uniform vec2 u_sourceTexelSize;
out vec4 fragColor;

void main() {
  vec3 result = vec3(0.0);
  float totalWeight = 0.0;

  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 sampleCoord = texCoords + vec2(float(dx), float(dy)) * u_sourceTexelSize;
      float fg = texture(u_mask, sampleCoord).r;
      float bgWeight = 1.0 - smoothstep(0.12, 0.55, fg);

      result += texture(u_texture, sampleCoord).rgb * bgWeight;
      totalWeight += bgWeight;
    }
  }

  if (totalWeight < 0.001) {
    result = texture(u_texture, texCoords).rgb;
    totalWeight = 1.0;
  }

  fragColor = vec4(result / totalWeight, 1.0);
}
`

/**
 * Mask-weighted Gaussian blur for the background.
 * Each sample is weighted by the INVERSE of the mask at that location,
 * preventing foreground pixels from bleeding into the blurred background.
 * This is the key anti-halo technique used by Meet and Slack.
 */
export const MASK_WEIGHTED_BLUR_SHADER = `#version 300 es
precision mediump float;
in vec2 texCoords;
uniform sampler2D u_texture;    // frame to blur
uniform sampler2D u_mask;       // foreground mask (1.0 = person, 0.0 = background)
uniform vec2 u_texelSize;
uniform vec2 u_direction;
uniform float u_radius;
out vec4 fragColor;

void main() {
  float sigma = u_radius;
  float twoSigmaSq = 2.0 * sigma * sigma;
  float totalWeight = 0.0;
  vec3 result = vec3(0.0);
  const int MAX_SAMPLES = 16;
  int radius = int(min(float(MAX_SAMPLES), ceil(u_radius)));

  for (int i = -MAX_SAMPLES; i <= MAX_SAMPLES; ++i) {
    float offset = float(i);
    if (abs(offset) > float(radius)) continue;

    float gaussWeight = exp(-(offset * offset) / twoSigmaSq);
    vec2 sampleCoord = texCoords + u_direction * u_texelSize * offset;

    // Mask-weight: suppress contribution from foreground pixels
    float maskVal = texture(u_mask, sampleCoord).r;
    float maskWeight = 1.0 - maskVal;
    // Foreground samples should contribute as little as possible here; even a
    // small floor creates visible "ghosts" above and beside the subject once
    // the large blur kernel smears them into the scene.
    float weight = gaussWeight * max(maskWeight, 0.001);

    result += texture(u_texture, sampleCoord).rgb * weight;
    totalWeight += weight;
  }

  fragColor = vec4(result / max(totalWeight, 0.001), 1.0);
}
`

/**
 * Final compositing: mix blurred background with original frame.
 * Uses smoothstep for a clean, tunable soft edge transition.
 */
export const COMPOSITE_SHADER = `#version 300 es
precision mediump float;
in vec2 texCoords;
uniform sampler2D background;
uniform sampler2D frame;
uniform sampler2D mask;
out vec4 fragColor;
void main() {
  vec4 frameTex = texture(frame, texCoords);
  vec4 bgTex = texture(background, texCoords);
  float maskVal = texture(mask, texCoords).r;

  // Keep the final matte slightly foreground-biased so ears, temples, and
  // profile turns survive even when the segmentation model is conservative.
  float alpha = smoothstep(0.26, 0.72, clamp(maskVal + 0.035, 0.0, 1.0));

  fragColor = mix(bgTex, frameTex, alpha);
}
`
