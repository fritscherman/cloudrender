
precision highp float;
uniform float u_time;
uniform vec2  u_resolution;

// ── Interaction channel (see components/RealtimeCanvas.vue) ──
// Fed locally by the pointer today; the same uniforms are where a tracking
// channel or engine variable is injected later (via the canvas' `inputs` prop).
uniform vec2  u_pointer;       // pointer position, 0..1, bottom-left origin
uniform vec2  u_pointer_smooth; // the same, eased: walks to a jump in ~0.5 s
uniform float u_pointer_down;  // 1.0 while pressed, else 0.0
uniform vec3  u_click;         // xy = last click (0..1); z = seconds since it

// ── Audio channel ──
// Overall level + an 8-band spectrum (bass→treble), each 0..1. Fed by a
// simulated signal in the browser preview and by the engine's audio meter on
// real output (or by OSC/variables writing realtime.audio.*). Default 0.
uniform float u_level;
uniform float u_spectrum[8];

float hash21(vec2 p){
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i = 0; i < 5; i++){ v += a * vnoise(p); p *= 2.02; a *= 0.5; }
  return v;
}
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// Transparent background (the `u_transparent` toggle a source opts into with
// transparentBackground()): `fg` is the picture drawn over BLACK, and its
// brightest channel becomes coverage, so a clock's digits and glow sit over
// whatever layer is beneath instead of over a filled rectangle. The result is
// STRAIGHT alpha — the engine's display program multiplies rgb by alpha itself
// (mh-realtime-Manager "norm"), and the preview contexts are created with
// premultipliedAlpha: false to match.
// The faintest few percent of a glow's tail are cut, or its never-quite-zero
// exp() falloff would tint the entire picture beneath.
vec4 overlayOnBlack(vec3 fg){
  fg = clamp(fg, 0.0, 1.0);
  float a = max(max(fg.r, fg.g), fg.b);
  return vec4(a > 0.0 ? fg / a : vec3(0.0), clamp((a - 0.04) / 0.96, 0.0, 1.0));
}


uniform float u_speed;
uniform float u_bright;
uniform float u_daylight;
uniform float u_view;
uniform float u_altitude;
uniform float u_cover;
uniform float u_puff;
uniform float u_sun;
uniform float u_haze;
uniform float u_bank;
uniform float u_quality;
uniform float u_holes;
uniform float u_holesize;
uniform float u_density;   // optical density: 1 = the original look
uniform float u_ctype;     // Cloud type: the SHAPE of the deck (index of the select)
uniform float u_tod;       // Time of day, hours (Daylight = "By time of day")
uniform float u_rays;      // Light rays: sunlight scattered in the clear air
uniform float u_city;      // City lights at night
uniform float u_lightning; // automatic lightning, strikes per time
uniform float u_flash;     // a flash held by hand / a binding (0..1)
uniform sampler2D u_ground;
uniform float u_ground_set;
uniform float u_groundscale;
const float CF_TOP = 1.4;

// The cloud type: what the sliders cannot say — how tall the layer is, the
// size and stretch of the heaps, how fast they round off towards the top,
// how much of the sky they claim, how much the tops are eroded and how much
// the shapes vary. Set once per pixel by cfCloudType(); Cumulus (0) is the
// original deck (the same values; a rim pixel may differ by float rounding).
// Coverage, Density, Holes and the rest
// apply on top of whichever type is chosen.
float cfTop = CF_TOP;
vec3  cfScale = vec3(0.6, 0.95, 0.6);
float cfTopK = 0.65;
float cfCovBias = 0.0;
float cfErode = 1.0;
float cfVary = 1.0;
float cfBig = 0.0;    // large-scale relief of the tops: higher regions cast long shadows on lower ones
float cfLong = 0.0;   // weight of the long shadow sample (cloud-on-cloud shadows)
float cfCam = 1.0;    // camera height over the layer, as a multiple of the usual
float cfFarK = 1.0;   // draw distance, as a multiple of CF_FAR
float cfSharp = 1.0;  // how quickly a cell turns opaque at its edge
float cfStep = 1.0;   // march step, as a multiple of the usual (small cells need small steps)
float cfSkyK = 0.0;   // > 0: the sky turns from the horizon tone to the zenith's
                      // within a few degrees (1 - exp(-up·K)), instead of the
                      // gentle pow(up, 0.45) of the lower types
void cfCloudType(float k){
  if(k < 0.5){        // cumulus: the original deck
  } else if(k < 1.5){ // sea of clouds: broad, flat-topped, almost closed
    cfScale = vec3(0.36, 1.1, 0.36); cfTopK = 1.5; cfCovBias = 0.2; cfErode = 0.6;
  } else if(k < 2.5){ // towering cumulus: tall, separate towers
    cfTop = 2.8; cfScale = vec3(0.5, 0.5, 0.5); cfTopK = 0.35; cfCovBias = -0.2; cfErode = 1.3;
  } else if(k < 3.5){ // stratus / fog sea: one smooth, softly rolling blanket
    cfScale = vec3(0.28, 1.6, 0.28); cfTopK = 3.0; cfCovBias = 0.45; cfErode = 0.0; cfVary = 0.45;
  } else if(k < 4.5){ // altocumulus: many small puffs in a thin layer
    cfTop = 0.9; cfScale = vec3(1.7, 2.2, 1.7); cfTopK = 1.0; cfCovBias = -0.04; cfErode = 0.5;
  } else if(k < 5.5){ // cloud streets: rows of heaps along the flight
    cfScale = vec3(1.05, 0.95, 0.3); cfTopK = 0.8; cfCovBias = -0.08;
  } else {            // high cruise: the view from 10 km — a vast, fine-grained
                      // deck of small cauliflower cells out to the horizon,
                      // higher regions casting long blue shadows on lower ones
    cfTop = 1.0; cfScale = vec3(2.6, 2.4, 2.6); cfTopK = 0.9; cfCovBias = 0.22;
    cfErode = 1.0; cfBig = 0.4; cfLong = 1.0; cfCam = 3.2; cfFarK = 1.8; cfSharp = 2.2;
    cfStep = 0.3; cfSkyK = 9.0;
  }
}
const float CF_FAR = 40.0;

// The daylight preset: sun elevation (radians), sun colour, sky zenith and
// horizon, ambient. Index = the Daylight select.
void cfPreset(float k, out float el, out vec3 sun, out vec3 top, out vec3 hor, out vec3 amb){
  if(k < 0.5){        // dawn
    el = 0.05;  sun = vec3(1.0, 0.62, 0.42) * 1.6; top = vec3(0.20, 0.27, 0.50); hor = vec3(0.98, 0.66, 0.50); amb = vec3(0.36, 0.36, 0.52);
  } else if(k < 1.5){ // morning
    el = 0.30;  sun = vec3(1.0, 0.92, 0.80) * 2.0; top = vec3(0.24, 0.46, 0.82); hor = vec3(0.74, 0.83, 0.94); amb = vec3(0.50, 0.60, 0.80);
  } else if(k < 2.5){ // noon
    el = 1.05;  sun = vec3(1.0, 0.98, 0.95) * 2.2; top = vec3(0.10, 0.33, 0.78); hor = vec3(0.62, 0.77, 0.96); amb = vec3(0.52, 0.63, 0.86);
  } else if(k < 3.5){ // golden hour
    el = 0.13;  sun = vec3(1.0, 0.76, 0.46) * 2.0; top = vec3(0.24, 0.37, 0.66); hor = vec3(1.0, 0.80, 0.56); amb = vec3(0.46, 0.44, 0.54);
  } else if(k < 4.5){ // sunset
    el = 0.02;  sun = vec3(1.0, 0.45, 0.20) * 2.2; top = vec3(0.16, 0.16, 0.38); hor = vec3(1.0, 0.48, 0.27); amb = vec3(0.32, 0.24, 0.36);
  } else if(k < 5.5){ // blue hour
    el = -0.07; sun = vec3(0.55, 0.40, 0.65) * 0.6; top = vec3(0.04, 0.07, 0.20); hor = vec3(0.36, 0.30, 0.48); amb = vec3(0.14, 0.16, 0.30);
  } else {            // moonlit night
    el = 0.12;  sun = vec3(0.60, 0.70, 0.95) * 0.7; top = vec3(0.004, 0.008, 0.025); hor = vec3(0.03, 0.045, 0.09); amb = vec3(0.03, 0.04, 0.08);
  }
}

// Daylight "By time of day": the presets above as keyframes along 24 hours
// (night → blue hour → dawn → morning → noon → afternoon → golden hour →
// sunset → blue hour → night), blended smoothly. `nw` is how much of it is
// night — stars and the moon come in with it. The "sun" of the night preset
// is the moon, so it rises during the evening blue hour.
void cfDay(float h, out float el, out vec3 sun, out vec3 top, out vec3 hor, out vec3 amb, out float nw){
  h = mod(h, 24.0);
  float h0 = 20.8; float h1 = 28.8; float k0 = 6.0; float k1 = 6.0;
  if(h < 4.8){ h0 = -3.2; h1 = 4.8; k0 = 6.0; k1 = 6.0; }
  else if(h < 5.6){ h0 = 4.8; h1 = 5.6; k0 = 6.0; k1 = 5.0; }
  else if(h < 6.3){ h0 = 5.6; h1 = 6.3; k0 = 5.0; k1 = 0.0; }
  else if(h < 8.5){ h0 = 6.3; h1 = 8.5; k0 = 0.0; k1 = 1.0; }
  else if(h < 12.5){ h0 = 8.5; h1 = 12.5; k0 = 1.0; k1 = 2.0; }
  else if(h < 16.0){ h0 = 12.5; h1 = 16.0; k0 = 2.0; k1 = 1.0; }
  else if(h < 18.0){ h0 = 16.0; h1 = 18.0; k0 = 1.0; k1 = 3.0; }
  else if(h < 19.2){ h0 = 18.0; h1 = 19.2; k0 = 3.0; k1 = 4.0; }
  else if(h < 19.9){ h0 = 19.2; h1 = 19.9; k0 = 4.0; k1 = 5.0; }
  else if(h < 20.8){ h0 = 19.9; h1 = 20.8; k0 = 5.0; k1 = 6.0; }
  float w = smoothstep(0.0, 1.0, (h - h0) / (h1 - h0));
  float e0; vec3 s0; vec3 t0; vec3 r0; vec3 a0;
  float e1; vec3 s1; vec3 t1; vec3 r1; vec3 a1;
  cfPreset(k0, e0, s0, t0, r0, a0);
  cfPreset(k1, e1, s1, t1, r1, a1);
  el = mix(e0, e1, w); sun = mix(s0, s1, w); top = mix(t0, t1, w);
  hor = mix(r0, r1, w); amb = mix(a0, a1, w);
  nw = mix(step(5.5, k0), step(5.5, k1), w);
}

float cfHash(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float cfNoise(vec3 x){
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cfHash(i), cfHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(cfHash(i + vec3(0.0, 1.0, 0.0)), cfHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(cfHash(i + vec3(0.0, 0.0, 1.0)), cfHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(cfHash(i + vec3(0.0, 1.0, 1.0)), cfHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}

// Cloud density at p, signed (clamp it at 0 for the density itself).
// `detail` scales the finest octave and the
// small-scale erosion that makes the tops cauliflower-like: both fade out
// with distance, where the long steps would only alias them into grain (the
// shadow ray passes 0, as it only needs the coarse shape).
float cfDensity(vec3 p, float t, float detail){
  float h = p.y / cfTop;
  if(h < 0.0 || h > 1.0) return -1.0;
  float field = vnoise(p.xz * 0.06 + 3.7) * 0.65 + vnoise(p.xz * 0.17 + 9.1) * 0.35;
  float cov = clamp(u_cover + cfCovBias + (field - 0.5) * 1.2, 0.0, 1.0);
  // holes: clear openings punched through the deck wherever a slow noise
  // field crosses a threshold set by Holes (none at 0, about half the sky
  // at 1), their walls sloping outwards towards the tops
  vec2 hp = p.xz / max(u_holesize, 0.2);
  float hf = vnoise(hp * 0.16 + 17.3) * 0.75 + vnoise(hp * 0.5 + 4.1) * 0.25;
  hf = (hf - 0.5) * 2.2 + 0.5;   // the sum of two noises bunches round 0.5
  float thr = 1.05 - u_holes * 0.65;
  float hole = smoothstep(thr, thr + 0.3, hf);
  vec3 q = p * cfScale + vec3(t * 0.03, -t * 0.01, 0.0);
  float n = 0.6 * cfNoise(q) + 0.28 * cfNoise(q * 2.1 + 1.3);
  n += 0.12 * mix(0.5, cfNoise(q * 4.3 + 2.7), clamp(detail * 1.5, 0.0, 1.0));
  n = 0.5 + (n - 0.5) * cfVary;
  // heaps: dense where the noise is high, thinning with height so the tops
  // come out rounded and at different heights, flat at the base
  // (the last term tapers every heap off below the layer's ceiling, so a
  // tall one rounds off instead of being sliced flat by the slab's top)
  float d = n + cov * 0.9 - 1.0 - h * h * cfTopK - hole * (0.9 + 0.5 * h)
          - smoothstep(0.72, 1.0, h) * 0.9;
  if(cfBig > 0.0) d += cfBig * (vnoise(p.xz * 0.045 + 21.0) - 0.5) * (0.4 + 1.2 * h);
  d *= smoothstep(0.0, 0.08, h);
  if(detail * cfErode > 0.01 && d > 0.0) d -= detail * cfErode * 0.07 * (1.0 - cfNoise(q * 7.3 + 5.3));
  // SIGNED: below 0 is clear air, and how far below says how near the next
  // cloud is — the march uses that to slow down before it reaches a rim
  return d * 5.0 * cfSharp;
}

// Is the land at ground point g built up? Read from the Ground image where one
// is set: built-up land in a natural-colour satellite picture is a light,
// slightly BLUISH grey — unsaturated, bluer than red and green, bright.
// (Measured on the shipped Landsat picture: ~4 % of it, its villages and
// towns; a plain "unsaturated" test took 43 %, every pale field.) Without a
// picture, scattered towns from a noise field.
float cfUrban(vec2 g){
  if(u_ground_set > 0.5){
    vec2 gu = g / max(u_groundscale, 0.5);
    gu = 1.0 - abs(1.0 - mod(gu, 2.0));
    vec3 cc = texture2D(u_ground, gu).rgb;
    float sat = max(max(cc.r, cc.g), cc.b) - min(min(cc.r, cc.g), cc.b);
    return (1.0 - smoothstep(0.06, 0.1, sat)) * smoothstep(0.0, 0.02, cc.b - cc.r)
         * step(cc.g, cc.b + 0.005) * smoothstep(0.27, 0.33, dot(cc, vec3(0.3, 0.59, 0.11)));
  }
  return smoothstep(0.56, 0.64, vnoise(g * 0.1 + 11.0));
}

vec3 cfSky(vec3 ro, vec3 rd, vec3 sd, vec3 sun, vec3 top, vec3 hor, float night, float t){
  float up = max(rd.y, 0.0);
  // (from high up the pale band on the horizon is thin and the sky deep
  // blue a few degrees above it: High cruise turns faster — smoothly from
  // the horizon, which a steep pow() drew as an edge against the deck)
  vec3 c = mix(hor, top, cfSkyK > 0.0 ? 1.0 - exp(-up * cfSkyK) : pow(up, 0.45));
  float s = max(dot(rd, sd), 0.0);
  // glow round the sun (tight for the moon), then the disc
  c += sun * (0.22 * pow(s, 6.0) + 0.5 * pow(s, 60.0)) * (1.0 - 0.85 * night);
  c += sun * night * 0.6 * pow(s, 400.0);
  c += sun * 5.0 * smoothstep(0.99955 + 0.0002 * night, 0.99985, s);
  if(night > 0.01){
    vec2 sp = rd.xz / (rd.y + 0.35) * 90.0;
    vec2 cell = floor(sp);
    float star = step(0.985, hash21(cell));
    float tw = 0.6 + 0.4 * sin(t * 2.0 + hash21(cell + 7.0) * 40.0);
    c += vec3(0.9, 0.95, 1.0) * star * tw * (1.0 - smoothstep(0.0, 0.35, length(fract(sp) - 0.5))) * smoothstep(0.0, 0.25, up) * 0.9 * night;
  }
  // high cirrus streaks on a plane far above
  if(rd.y > 0.01){
    vec2 cp = ro.xz + rd.xz * (7.0 - ro.y) / rd.y;
    float ci = fbm(cp * vec2(0.05, 0.16) + vec2(t * 0.004, 0.0));
    float ca = smoothstep(0.5, 0.8, ci) * smoothstep(0.01, 0.2, rd.y) * 0.55;
    c = mix(c, hor * 0.55 + sun * 0.35 + top * 0.1, ca);
  }
  return c;
}

float cfRoundBox(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  float t = u_time;
  float el; vec3 sun; vec3 top; vec3 hor; vec3 amb; float night;
  bool byTime = u_daylight > 6.5;
  if(byTime){
    cfDay(u_tod, el, sun, top, hor, amb, night);
  } else {
    cfPreset(u_daylight, el, sun, top, hor, amb);
    night = step(5.5, u_daylight);
  }
  cfCloudType(u_ctype);
  if(cfCam > 1.5){
    // at cruising altitude there is less air overhead: the sky is a deeper
    // blue, and the haze lies as a pale, whitish band on the deck's horizon
    top *= vec3(0.72, 0.82, 1.0);
    hor = mix(hor, vec3(0.78, 0.9, 1.0) * max(max(hor.r, hor.g), hor.b) * 1.6, 0.5);
  }
  // how dark it is: city lights come on with it (by preset or by the hour)
  float dark = clamp(1.0 - dot(amb, vec3(0.333)) * 3.2, 0.0, 1.0);
  vec3 cityCol = vec3(1.0, 0.62, 0.3);
  vec3 flashCol = vec3(0.78, 0.82, 1.0);

  // the cabin window: an oval opening in the wall panel
  bool framed = u_view > 1.5;
  float win = 0.0;
  if(framed){
    win = cfRoundBox(uv, vec2(0.25, 0.36), 0.2);
    if(win > 0.045){
      float lum = dot(amb + sun * max(el, 0.0) * 0.4, vec3(0.33));
      vec3 wall = vec3(0.86, 0.84, 0.80) * (0.18 + 0.7 * clamp(lum, 0.0, 1.2));
      wall *= 0.85 + 0.15 * smoothstep(-0.6, 0.6, uv.y);
      wall *= 1.0 - 0.5 * exp(-(win - 0.045) * 40.0);   // the reveal's shadow
      gl_FragColor = vec4(clamp(wall * u_bright, 0.0, 1.0), 1.0);
      return;
    }
    uv *= 1.3;
  }

  // the camera: forward, or looking out of the right-hand side
  float side = step(0.5, u_view);
  float yaw = side * 1.5708;
  float pitch = mix(-0.13, -0.22, side);
  float roll = u_bank * (0.07 * sin(t * 0.11) + 0.03 * sin(t * 0.37));
  vec3 fwd = vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch));
  vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 upv = cross(fwd, rgt);
  vec3 r2 = rgt * cos(roll) + upv * sin(roll);
  vec3 u2 = upv * cos(roll) - rgt * sin(roll);
  vec3 rd = normalize(fwd * 1.5 + r2 * uv.x + u2 * uv.y);
  // altitude relative to the layer's top, so every cloud type is flown over
  // (or through) the same way; for Cumulus this is the original 0.7 .. 3.2
  // (a type flown high raises only the TOP of the altitude range, so the
  // lowest setting still flies through the layer)
  vec3 ro = vec3(0.0, cfTop * mix(0.5, 2.2857 * cfCam, u_altitude) + 0.03 * sin(t * 0.5), t * u_speed * 0.7);
  float cfFarD = CF_FAR * cfFarK;

  // Lightning: a light INSIDE the clouds ahead of the camera. Strikes come
  // from clip time alone (half-second slots, each struck or not by a hash),
  // so every client of a fleet shows the same flash; Flash holds one by
  // hand or through a binding (a variable, the audio level).
  vec3 hf = normalize(vec3(fwd.x, 0.0, fwd.z));
  vec3 hr = vec3(hf.z, 0.0, 0.0 - hf.x);
  vec3 flp = ro + hf * 7.0 + hr * 1.5;
  flp.y = cfTop * 0.45;
  float fl = 0.0;
  if(u_lightning > 0.0){
    float slot = floor(t * 2.0);
    if(hash21(vec2(slot, 7.1)) < u_lightning * 0.35){
      float lt = fract(t * 2.0) * 0.5;   // seconds into the strike
      fl = exp(-lt * 14.0) + 0.7 * exp(-abs(lt - 0.12) * 60.0);
      flp = ro + hf * (5.0 + 10.0 * hash21(vec2(slot, 5.7))) + hr * ((hash21(vec2(slot, 1.3)) - 0.5) * 9.0);
      flp.y = cfTop * (0.25 + 0.35 * hash21(vec2(slot, 2.9)));
    }
  }
  fl = max(fl, clamp(u_flash, 0.0, 1.0));

  float az = u_sun * 6.28318 + (byTime ? (mod(u_tod, 24.0) - 12.0) * 0.05 : 0.0);
  vec3 sd = normalize(vec3(sin(az) * cos(el), sin(el), cos(az) * cos(el)));
  // Air: there is always a little (a clear day still fades the far deck),
  // Haze adds more; and whatever the Haze, the far edge of what is drawn
  // fades fully into the horizon colour, so nothing ends in a hard line
  // — with no haze at all the far deck used to stop as a flat band.
  float haze = 0.008 + max(u_haze, 0.0) * 0.05;
  // The colour the air fades things TO: the sky's own colour at the horizon
  // in this direction — the horizon tone plus the sun's glow the sky draws
  // there. With the flat horizon tone alone the far deck stood as a darker
  // band in front of the glowing sky round a low sun.
  vec3 hdir = normalize(vec3(rd.x, 0.0, rd.z) + vec3(1e-5, 0.0, 0.0));
  float hs = max(dot(hdir, sd), 0.0);
  vec3 fogc = hor + sun * (0.22 * pow(hs, 6.0) + 0.5 * pow(hs, 60.0)) * (1.0 - 0.85 * night);
  // The light in a cloud's SHADOW is the sky's: the ambient term keeps its
  // brightness but takes the hue of the sky overhead — the cool blue of the
  // valleys between the heaps by day, violet at dusk (from a photograph
  // taken at cruising altitude; a grey ambient read as dust).
  float ambL = dot(amb, vec3(0.3, 0.59, 0.11));
  float topL = max(dot(top, vec3(0.3, 0.59, 0.11)), 1e-3);
  vec3 skyAmb = mix(amb, top / topL * ambL, 0.55) * 1.1;

  // the background: sky above the horizon, the land far below it
  vec3 bg;
  if(rd.y > 0.0){
    bg = cfSky(ro, rd, sd, sun, top, hor, night, t);
  } else {
    float tg = (-5.0 - ro.y) / rd.y;
    vec2 g = ro.xz + rd.xz * tg;
    vec3 light = sun * max(sd.y, 0.0) * 0.8 + amb * 0.5;
    // the clouds' shadow: the deck's density where the sun's ray from
    // this spot crosses its middle
    if(sd.y > 0.05){
      vec3 sp = vec3(g.x, -5.0, g.y) + sd * ((0.5 * cfTop + 5.0) / sd.y);
      light = mix(amb * 0.5, light, exp(-max(cfDensity(sp, t, 0.0), 0.0) * 1.2 * u_density));
    }
    // How much ground one pixel covers, along the view (a grazing view
    // stretches it): past a texel or two the picture — or the procedural
    // land — would shimmer as it scrolls, so it is averaged over the
    // footprint and, further out, fades to its average colour. The engine
    // uploads the ground without mipmaps; this does their job.
    float foot = tg / (1.5 * u_resolution.y) / max(-rd.y, 0.03);
    vec2 along = normalize(rd.xz + vec2(1e-5, 0.0)) * foot;
    vec3 land;
    if(u_ground_set > 0.5){
      // the picture, tiled with mirrored repeats (no seam, whatever the
      // image's size or the texture's wrap mode); one tile = Ground scale
      float gs = max(u_groundscale, 0.5);
      float texels = foot / gs * 1024.0;
      vec3 tex = vec3(0.0);
      for(int k = 0; k < 4; k++){
        vec2 gu = (g + along * ((float(k) - 1.5) * 0.5)) / gs;
        gu = 1.0 - abs(1.0 - mod(gu, 2.0));
        tex += texture2D(u_ground, gu).rgb * 0.25;
      }
      vec3 avg = (texture2D(u_ground, vec2(0.21, 0.27)).rgb + texture2D(u_ground, vec2(0.73, 0.19)).rgb
                + texture2D(u_ground, vec2(0.48, 0.52)).rgb + texture2D(u_ground, vec2(0.17, 0.81)).rgb
                + texture2D(u_ground, vec2(0.79, 0.76)).rgb) * 0.2;
      land = mix(tex, avg, smoothstep(2.0, 8.0, texels)) * light * 0.55;
    } else {
      float f = fbm(g * 0.12);
      land = mix(vec3(0.10, 0.16, 0.10), vec3(0.24, 0.24, 0.16), smoothstep(0.35, 0.7, f));
      land = mix(vec3(0.05, 0.10, 0.18), land, smoothstep(0.38, 0.42, fbm(g * 0.03 + 4.0)));
      land = mix(land, vec3(0.13, 0.16, 0.13), smoothstep(0.3, 1.5, foot));
      land *= light;
    }
    // City lights: single points where the land is built up, averaged to a
    // glow once a pixel covers several of them (or they would sparkle)
    // City lights: POINTS, one per small ground cell at a random spot in it,
    // lit only where the land there is built up, each its own brightness.
    // A point is never drawn smaller than about a pixel, and its brightness
    // is spread over its size (energy kept), so as it shrinks into the
    // distance it becomes the soft glow of a town instead of flickering.
    if(u_city > 0.0 && dark > 0.0){
      const float CELL = 0.12;
      vec2 cell = floor(g / CELL);
      float on = step(0.45, hash21(cell + 17.0));
      vec2 at = (cell + 0.2 + 0.6 * vec2(hash21(cell + 3.1), hash21(cell + 9.7))) * CELL;
      float r = max(0.02, foot * 0.9);
      float pt = exp(-dot(g - at, g - at) / (r * r)) * min(1.0, (0.02 * 0.02) / (r * r));
      float glow = 0.12 * smoothstep(0.03, 0.12, foot);   // far: the average of the points
      float lamp = (0.5 + hash21(cell + 5.3)) * on;
      land += cityCol * cfUrban(on > 0.5 ? at : g) * (pt * lamp * 10.0 + glow) * u_city * dark;
    }
    bg = mix(land, fogc, max(1.0 - exp(-tg * haze * 0.6), smoothstep(40.0, 150.0, tg)));
    // a sun (or moon) on the horizon sinks softly into the far haze rather
    // than being cut by the line where the sky ends
    float sdisc = smoothstep(0.99955 + 0.0002 * night, 0.99985, max(dot(rd, sd), 0.0));
    bg += sun * 5.0 * sdisc * smoothstep(-0.03, 0.0, rd.y);
  }

  // march the deck
  float tA = (0.0 - ro.y) / (abs(rd.y) < 1e-4 ? 1e-4 : rd.y);
  float tB = (cfTop - ro.y) / (abs(rd.y) < 1e-4 ? 1e-4 : rd.y);
  float t0 = max(min(tA, tB), 0.0);
  float t1 = min(max(tA, tB), cfFarD);
  vec3 acc = vec3(0.0);
  float T = 1.0;
  float tEnd = t1;
  if(t1 > t0){
    float steps = clamp(u_quality, 16.0, 96.0);
    // flying INSIDE the layer every ray passes near clouds, and the fine
    // steps there spent the budget before the next cloud was reached — the
    // pixel then ended on the far-deck colour or not, per pixel: grain
    // (measured 0.55 → 0.16 on Cumulus at the lowest altitude)
    if(ro.y < cfTop) steps = min(96.0, steps * 1.7);
    // steps that grow with distance: fine near the camera (flying through
    // the layer), long where the haze hides the detail anyway, so the same
    // step count reaches the far deck
    float rate = 0.06 * 56.0 / steps;
    // White-noise dither of the first step. (Interleaved gradient noise was
    // tried and measured the same, but on a smooth, thin deck it shows as a
    // regular diagonal hatching; white noise reads as fine film grain.)
    float tt = t0 + clamp(t0 * rate, 0.1, 0.9) * cfStep * hash21(gl_FragCoord.xy);
    float cs = dot(rd, sd);
    float phase = 0.55 + 1.4 * pow(max(cs, 0.0), 6.0) + 0.25 * cs * cs;
    float dtPrev = 0.0;
    bool fine = false;
    float fineN = 0.0;

    for(int i = 0; i < 96; i++){
      if(float(i) >= steps) break;
      vec3 p = ro + rd * tt;
      float lod = exp(-tt * 0.15);
      float dr = cfDensity(p, t, u_puff * lod);
      float d = max(dr, 0.0);
      float dtc = clamp(tt * rate, 0.1, 0.9) * cfStep;
      // Long steps through clear air; NEAR a cloud (the signed density
      // says how near) back up to the last sample and go on in short ones,
      // so the rim is resolved rather than hit or missed by one long step
      // per pixel — which is what made rims crackle, at any Quality.
      if(!fine && dtPrev > 0.0 && dr > -2.0 * dtc){
        fine = true;
        fineN = 0.0;
        tt -= dtPrev;
        dtPrev = 0.0;
        continue;
      }
      // clear of it again (never straight after entering): long steps
      if(fine && fineN > 2.0 && dr < -2.0 * dtc) fine = false;
      float dt = fine ? max(0.04 * cfStep, dtc * 0.4) : dtc;
      fineN += 1.0;
      if(d > 0.0){
        float dl = max(cfDensity(p + sd * 0.12, t, 0.0), 0.0) + max(cfDensity(p + sd * 0.35, t, 0.0), 0.0);
        if(cfLong > 0.0) dl += cfLong * max(cfDensity(p + sd * 1.4, t, 0.0), 0.0);
        float shadow = exp(-dl * 1.6 * u_density);
        float h = clamp(p.y / cfTop, 0.0, 1.0);
        float powder = 1.0 - exp(-d * 2.0);
        vec3 lum = sun * shadow * phase * mix(0.5, 1.0, powder) + skyAmb * (0.15 + 0.75 * h);
        // the towns' glow on the clouds' undersides, and a flash inside them
        lum += cityCol * u_city * dark * 0.05 * (1.0 - h);
        lum += flashCol * fl * 5.0 * exp(-length(p - flp) * 0.45);
        lum = mix(lum, fogc, max(1.0 - exp(-tt * haze), smoothstep(0.65 * cfFarD, cfFarD, tt)));
        float a = 1.0 - exp(-d * dt * 2.6 * u_density);
        acc += T * a * lum;
        T *= 1.0 - a;
        if(T < 0.02) break;
      }
      dtPrev = dt;
      tt += dt;
      if(tt > t1) break;
    }
    tEnd = min(tt, t1);
  }
  // where the ray stays in the layer out to the horizon, or — flying inside
  // the layer — ran out of steps before leaving it. Not for a ray from ABOVE
  // whose budget ran out inside a thin cloud: that one keeps the land behind
  // it, or neighbouring pixels flip between the two and the rim turns to grain
  bool inLayer = ro.y < cfTop;
  // (a ray from above that reaches the layer only BEYOND the draw distance
  // sees the deck too — seen from high up the deck runs to the horizon)
  bool farDeck = rd.y < 0.0 && max(tA, tB) >= cfFarD - 1e-3;
  if(farDeck || (t1 > t0 && inLayer && tEnd < t1 - 1e-3)){
    // the deck goes on beyond the march: its lit top, lost in the haze
    float cs2 = max(dot(rd, sd), 0.0);
    vec3 far = sun * (0.45 + 0.6 * pow(cs2, 6.0)) * max(sd.y + 0.15, 0.0) + amb * 0.8;
    bg = mix(far, fogc, max(1.0 - exp(-max(tEnd, 8.0) * haze * 2.5), smoothstep(0.65 * cfFarD, cfFarD, tEnd)));
  }
  vec3 col = acc + T * bg;

  // Light rays (crepuscular rays), the way the eye sees them: from this
  // pixel, walk across the picture TOWARDS THE SUN and ask at each step
  // whether that direction sees the sun's bright sky or a cloud in front of
  // it (one coarse density read where that view crosses the deck). The
  // light gathered — fading with the distance walked — fans out from every
  // gap between cloud edges round the sun, and the clouds cast the dark
  // spokes between. A handful of reads per pixel, only with the sun in front.
  float sf = dot(sd, fwd);
  if(u_rays > 0.0 && sf > 0.0 && sd.y > -0.05){
    vec2 sunUv = vec2(dot(sd, r2), dot(sd, u2)) / sf * 1.5;
    float gat = 0.0;
    float full = 0.0;
    float wsum = 0.0;
    // (no per-pixel jitter: rays are broad, and jittered reads were grain)
    for(int k = 0; k < 10; k++){
      float f = (float(k) + 0.5) / 10.0;
      vec2 su = mix(uv, sunUv, f * 0.85);
      vec3 sdir = normalize(fwd * 1.5 + r2 * su.x + u2 * su.y);
      float occ = 0.0;
      if(ro.y < cfTop){
        // inside the layer: the towers near and further ahead
        float od = max(cfDensity(ro + sdir * 5.0, t, 0.0), 0.0) + max(cfDensity(ro + sdir * 12.0, t, 0.0), 0.0);
        occ = 1.0 - exp(-od * 1.5 * u_density);
      } else {
        // above it: where that view crosses the middle of the deck
        float tp = (0.55 * cfTop - ro.y) / (abs(sdir.y) < 1e-3 ? 1e-3 : sdir.y);
        if(tp > 0.0 && tp < cfFarD)
          occ = clamp(max(cfDensity(ro + sdir * tp, t, 0.0), 0.0) * 1.5 * u_density, 0.0, 1.0);
      }
      // only within some 15° of the sun: further out the few reads would
      // copy the clouds' shapes across the picture as ghosts
      float bright = pow(max(dot(sdir, sd), 0.0), 48.0);
      float w = 1.0 - f * 0.6;
      gat += (1.0 - occ) * bright * w;
      full += bright * w;
      wsum += w;
    }
    // The CONTRAST is the ray: light through the gaps brightens, the share
    // a cloud blocks darkens the spoke behind it. Unblocked sky adds nothing
    // more than the glow the sky already has, so a clear sun stays clean.
    float lit = gat / wsum;
    float blocked = (full - gat) / wsum;
    // (the moon draws them too, but faintly)
    float fade = u_rays * smoothstep(0.0, 0.3, sf) * smoothstep(-0.05, 0.05, sd.y) * (1.0 - 0.8 * night);
    col += sun * lit * blocked * 2.5 * fade;
    // the spokes: darken only what shows BEHIND the clouds (the sky)
    col -= T * bg * clamp(blocked * 0.35 * fade, 0.0, 0.3);
  }
  col += flashCol * fl * 0.08;   // the whole sky brightens with a strike
  col = 1.0 - exp(-col * 1.25);

  if(framed){
    // the plastic bezel round the pane, and a faint tint on the glass
    col *= vec3(0.96, 0.98, 1.0);
    float bez = smoothstep(0.0, 0.01, win) * (1.0 - smoothstep(0.035, 0.045, win));
    float lum = dot(amb + sun * max(el, 0.0) * 0.4, vec3(0.33));
    vec3 bezel = vec3(0.62, 0.61, 0.60) * (0.15 + 0.6 * clamp(lum, 0.0, 1.2)) * (0.7 + 0.3 * smoothstep(0.0, 0.045, win));
    col = mix(col, bezel, bez);
  }
  gl_FragColor = vec4(clamp(col * u_bright, 0.0, 1.0), 1.0);
}
