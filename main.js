const canvas = document.getElementById('scene');
const gl = canvas.getContext('webgl', {
	alpha: false,
	antialias: true,
	depth: true,
	stencil: false,
	premultipliedAlpha: false,
});

if (!gl) {
	throw new Error('WebGL is not supported in this browser.');
}

const terrainVertexSource = `
attribute vec3 aPosition;
attribute vec3 aNormal;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vHeight;

void main() {
	vec4 worldPosition = uModel * vec4(aPosition, 1.0);
	vWorldPosition = worldPosition.xyz;
	vNormal = mat3(uModel) * aNormal;
	vHeight = aPosition.y;
	gl_Position = uProjection * uView * worldPosition;
}
`;

const terrainFragmentSource = `
precision mediump float;

uniform vec3 uSunDirection;
uniform vec3 uCameraPosition;
uniform float uDayFactor;
uniform float uFogDensity;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vHeight;

float saturate(float value) {
	return clamp(value, 0.0, 1.0);
}

void main() {
	vec3 normal = normalize(vNormal);
	vec3 lightDir = normalize(uSunDirection);
	float diffuse = max(dot(normal, lightDir), 0.0);
	float backLight = max(dot(normal, normalize(vec3(-0.35, 0.7, 0.45))), 0.0);
	float slope = 1.0 - saturate(normal.y);

	vec3 rock = vec3(0.18, 0.22, 0.24);
	vec3 grass = vec3(0.15, 0.28, 0.17);
	vec3 snow = vec3(0.93, 0.95, 0.98);
	vec3 dirt = vec3(0.31, 0.24, 0.17);

	float snowMask = smoothstep(18.0, 33.0, vHeight + slope * 10.0);
	float grassMask = smoothstep(-2.0, 13.0, vHeight) * (1.0 - snowMask);
	float dirtMask = smoothstep(-12.0, 8.0, vHeight) * (1.0 - grassMask);

	vec3 baseColor = rock;
	baseColor = mix(baseColor, dirt, dirtMask);
	baseColor = mix(baseColor, grass, grassMask);
	baseColor = mix(baseColor, snow, snowMask);

	float ambient = mix(0.35, 0.14, 1.0 - uDayFactor);
	vec3 lightColor = mix(vec3(1.2, 1.05, 0.95), vec3(0.55, 0.7, 1.0), 1.0 - uDayFactor);
	vec3 litColor = baseColor * (ambient + diffuse * 1.2 * uDayFactor + backLight * 0.3);
	litColor += lightColor * 0.05 * pow(diffuse, 2.0);

	float heightFog = smoothstep(-8.0, 30.0, vHeight) * 0.35;
	float distanceFog = 1.0 - exp(-uFogDensity * length(uCameraPosition - vWorldPosition));
	float fogAmount = saturate(heightFog + distanceFog);

	vec3 dawnFog = vec3(0.54, 0.62, 0.7);
	vec3 nightFog = vec3(0.04, 0.07, 0.12);
	vec3 fogColor = mix(nightFog, dawnFog, uDayFactor);
	gl_FragColor = vec4(mix(litColor, fogColor, fogAmount), 1.0);
}
`;

const skyVertexSource = `
attribute vec2 aPosition;

varying vec2 vUv;

void main() {
	vUv = aPosition * 0.5 + 0.5;
	gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const skyFragmentSource = `
precision mediump float;

uniform float uTime;
uniform float uDayFactor;
uniform vec2 uResolution;

varying vec2 vUv;

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);

	float a = hash(i + vec2(0.0, 0.0));
	float b = hash(i + vec2(1.0, 0.0));
	float c = hash(i + vec2(0.0, 1.0));
	float d = hash(i + vec2(1.0, 1.0));

	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
	float value = 0.0;
	float amplitude = 0.5;
	for (int i = 0; i < 5; i++) {
		value += amplitude * noise(p);
		p *= 2.0;
		amplitude *= 0.5;
	}
	return value;
}

vec3 skyGradient(float y, float dayFactor) {
	vec3 dayTop = vec3(0.38, 0.63, 0.94);
	vec3 dayBottom = vec3(0.82, 0.91, 1.0);
	vec3 nightTop = vec3(0.03, 0.05, 0.11);
	vec3 nightBottom = vec3(0.08, 0.1, 0.18);
	vec3 top = mix(nightTop, dayTop, dayFactor);
	vec3 bottom = mix(nightBottom, dayBottom, dayFactor);
	return mix(bottom, top, smoothstep(0.0, 1.0, y));
}

float circle(vec2 uv, vec2 center, float radius) {
	return smoothstep(radius, radius - 0.012, distance(uv, center));
}

void main() {
	float dayFactor = smoothstep(0.05, 0.92, uDayFactor);
	vec2 uv = vUv;
	vec2 centered = uv * 2.0 - 1.0;

	vec3 color = skyGradient(uv.y, dayFactor);

	float dawnGlow = exp(-pow((uv.y - 0.22) * 5.0, 2.0)) * (1.0 - abs(centered.x) * 0.35);
	color += mix(vec3(0.2, 0.14, 0.28), vec3(0.95, 0.52, 0.26), dayFactor) * dawnGlow * 0.25;

	vec2 sunCenter = vec2(0.5 + cos(uTime * 0.07) * 0.33, 0.38 + sin(uTime * 0.07) * 0.22);
	vec2 moonCenter = vec2(0.5 + cos(uTime * 0.07 + 3.14159) * 0.33, 0.38 + sin(uTime * 0.07 + 3.14159) * 0.22);
	float sun = circle(uv, sunCenter, 0.075);
	float moon = circle(uv, moonCenter, 0.06) * (1.0 - dayFactor);

	color += vec3(1.0, 0.9, 0.66) * sun * dayFactor * 1.6;
	color += vec3(0.7, 0.8, 1.0) * moon * 0.7;

	float stars = 0.0;
	vec2 starUv = uv * vec2(uResolution.x / uResolution.y, 1.0) * 54.0;
	vec2 starCell = floor(starUv);
	vec2 starFrac = fract(starUv);
	float starHash = hash(starCell);
	float starMask = step(0.992, starHash) * smoothstep(0.08, 0.0, length(starFrac - 0.5));
	stars += starMask;
	stars += step(0.9975, hash(starCell + 13.37)) * smoothstep(0.045, 0.0, length(starFrac - vec2(0.62, 0.38)));
	color += vec3(1.0) * stars * (1.0 - dayFactor) * 1.5;

	float clouds = fbm(uv * vec2(5.5, 2.8) + vec2(uTime * 0.01, 0.0));
	float cloudBand = smoothstep(0.34, 0.72, clouds) * smoothstep(0.12, 0.9, uv.y);
	vec3 cloudTint = mix(vec3(0.4, 0.5, 0.65), vec3(1.0), dayFactor);
	color += cloudTint * cloudBand * 0.08;

	float horizonMist = smoothstep(0.0, 0.35, 1.0 - uv.y);
	color = mix(color, mix(vec3(0.1, 0.13, 0.19), vec3(0.76, 0.84, 0.93), dayFactor), horizonMist * 0.42);

	float vignette = smoothstep(1.3, 0.35, length(centered));
	color *= vignette;

	gl_FragColor = vec4(color, 1.0);
}
`;

function createShader(type, source) {
	const shader = gl.createShader(type);
	gl.shaderSource(shader, source);
	gl.compileShader(shader);

	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const info = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error(info || 'Unknown shader compilation error.');
	}

	return shader;
}

function createProgram(vertexSource, fragmentSource) {
	const program = gl.createProgram();
	gl.attachShader(program, createShader(gl.VERTEX_SHADER, vertexSource));
	gl.attachShader(program, createShader(gl.FRAGMENT_SHADER, fragmentSource));
	gl.linkProgram(program);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const info = gl.getProgramInfoLog(program);
		gl.deleteProgram(program);
		throw new Error(info || 'Unknown program link error.');
	}

	return program;
}

function createBuffer(data, target = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) {
	const buffer = gl.createBuffer();
	gl.bindBuffer(target, buffer);
	gl.bufferData(target, data, usage);
	return buffer;
}

function normalizeVector(vector) {
	const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
	return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function subtractVectors(a, b) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function crossVectors(a, b) {
	return [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];
}

function addVectors(a, b) {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function matrixIdentity() {
	return [
		1, 0, 0, 0,
		0, 1, 0, 0,
		0, 0, 1, 0,
		0, 0, 0, 1,
	];
}

function matrixPerspective(fovY, aspect, near, far) {
	const f = 1.0 / Math.tan(fovY / 2);
	const rangeInv = 1 / (near - far);
	return [
		f / aspect, 0, 0, 0,
		0, f, 0, 0,
		0, 0, (near + far) * rangeInv, -1,
		0, 0, near * far * rangeInv * 2, 0,
	];
}

function matrixLookAt(eye, target, up) {
	const zAxis = normalizeVector(subtractVectors(eye, target));
	const xAxis = normalizeVector(crossVectors(up, zAxis));
	const yAxis = crossVectors(zAxis, xAxis);

	return [
		xAxis[0], yAxis[0], zAxis[0], 0,
		xAxis[1], yAxis[1], zAxis[1], 0,
		xAxis[2], yAxis[2], zAxis[2], 0,
		-(xAxis[0] * eye[0] + xAxis[1] * eye[1] + xAxis[2] * eye[2]),
		-(yAxis[0] * eye[0] + yAxis[1] * eye[1] + yAxis[2] * eye[2]),
		-(zAxis[0] * eye[0] + zAxis[1] * eye[1] + zAxis[2] * eye[2]),
		1,
	];
}

function smoothNoise(x, z) {
	const ix = Math.floor(x);
	const iz = Math.floor(z);
	const fx = x - ix;
	const fz = z - iz;

	function hash2(a, b) {
		const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
		return s - Math.floor(s);
	}

	function fade(t) {
		return t * t * (3 - 2 * t);
	}

	const v00 = hash2(ix, iz);
	const v10 = hash2(ix + 1, iz);
	const v01 = hash2(ix, iz + 1);
	const v11 = hash2(ix + 1, iz + 1);

	const u = fade(fx);
	const v = fade(fz);
	const a = v00 * (1 - u) + v10 * u;
	const b = v01 * (1 - u) + v11 * u;
	return a * (1 - v) + b * v;
}

function fbm(x, z) {
	let value = 0;
	let amplitude = 0.5;
	let frequency = 0.014;
	for (let octave = 0; octave < 5; octave++) {
		value += amplitude * smoothNoise(x * frequency, z * frequency);
		amplitude *= 0.5;
		frequency *= 2.05;
	}
	return value;
}

function terrainHeight(x, z) {
	const ridge = Math.abs(fbm(x * 1.15, z * 1.15) - 0.5) * 2.0;
	const base = fbm(x, z) * 14.0;
	const mountains = Math.pow(ridge, 2.1) * 30.0;
	const valleys = (fbm(x * 0.5 + 81.0, z * 0.5 - 42.0) - 0.5) * 9.0;
	const distanceFalloff = Math.max(0, 1 - Math.hypot(x * 0.015, z * 0.015));
	return base + mountains * distanceFalloff + valleys;
}

function buildTerrain(gridSize, worldSize) {
	const verticesPerSide = gridSize + 1;
	const positions = new Float32Array(verticesPerSide * verticesPerSide * 3);
	const normals = new Float32Array(verticesPerSide * verticesPerSide * 3);
	const indices = new Uint16Array(gridSize * gridSize * 6);

	let positionOffset = 0;
	const heights = new Float32Array(verticesPerSide * verticesPerSide);

	for (let z = 0; z < verticesPerSide; z++) {
		const zRatio = z / gridSize;
		for (let x = 0; x < verticesPerSide; x++) {
			const xRatio = x / gridSize;
			const worldX = (xRatio - 0.5) * worldSize;
			const worldZ = (zRatio - 0.5) * worldSize;
			const height = terrainHeight(worldX, worldZ);
			heights[z * verticesPerSide + x] = height;
			positions[positionOffset++] = worldX;
			positions[positionOffset++] = height;
			positions[positionOffset++] = worldZ;
		}
	}

	let normalOffset = 0;
	for (let z = 0; z < verticesPerSide; z++) {
		for (let x = 0; x < verticesPerSide; x++) {
			const left = heights[z * verticesPerSide + Math.max(x - 1, 0)];
			const right = heights[z * verticesPerSide + Math.min(x + 1, gridSize)];
			const down = heights[Math.max(z - 1, 0) * verticesPerSide + x];
			const up = heights[Math.min(z + 1, gridSize) * verticesPerSide + x];

			const normal = normalizeVector([
				left - right,
				4.0,
				down - up,
			]);

			normals[normalOffset++] = normal[0];
			normals[normalOffset++] = normal[1];
			normals[normalOffset++] = normal[2];
		}
	}

	let indexOffset = 0;
	for (let z = 0; z < gridSize; z++) {
		for (let x = 0; x < gridSize; x++) {
			const topLeft = z * verticesPerSide + x;
			const topRight = topLeft + 1;
			const bottomLeft = (z + 1) * verticesPerSide + x;
			const bottomRight = bottomLeft + 1;

			indices[indexOffset++] = topLeft;
			indices[indexOffset++] = bottomLeft;
			indices[indexOffset++] = topRight;
			indices[indexOffset++] = topRight;
			indices[indexOffset++] = bottomLeft;
			indices[indexOffset++] = bottomRight;
		}
	}

	return { positions, normals, indices };
}

function setUniformMatrix(location, matrix) {
	gl.uniformMatrix4fv(location, false, new Float32Array(matrix));
}

function setUniformVector(location, vector) {
	gl.uniform3fv(location, new Float32Array(vector));
}

const terrainProgram = createProgram(terrainVertexSource, terrainFragmentSource);
const skyProgram = createProgram(skyVertexSource, skyFragmentSource);

const terrainLocations = {
	position: gl.getAttribLocation(terrainProgram, 'aPosition'),
	normal: gl.getAttribLocation(terrainProgram, 'aNormal'),
	projection: gl.getUniformLocation(terrainProgram, 'uProjection'),
	view: gl.getUniformLocation(terrainProgram, 'uView'),
	model: gl.getUniformLocation(terrainProgram, 'uModel'),
	sunDirection: gl.getUniformLocation(terrainProgram, 'uSunDirection'),
	cameraPosition: gl.getUniformLocation(terrainProgram, 'uCameraPosition'),
	dayFactor: gl.getUniformLocation(terrainProgram, 'uDayFactor'),
	fogDensity: gl.getUniformLocation(terrainProgram, 'uFogDensity'),
};

const skyLocations = {
	position: gl.getAttribLocation(skyProgram, 'aPosition'),
	time: gl.getUniformLocation(skyProgram, 'uTime'),
	dayFactor: gl.getUniformLocation(skyProgram, 'uDayFactor'),
	resolution: gl.getUniformLocation(skyProgram, 'uResolution'),
};

const terrain = buildTerrain(220, 180);

const terrainBuffers = {
	position: createBuffer(terrain.positions),
	normal: createBuffer(terrain.normals),
	index: createBuffer(terrain.indices, gl.ELEMENT_ARRAY_BUFFER),
};

const skyBuffer = createBuffer(new Float32Array([
	-1, -1,
	 1, -1,
	-1,  1,
	 1,  1,
]));

const keysDown = new Set();

const camera = {
	position: [0, 34, 92],
	target: [0, 18, 0],
};

function getCameraBasis(position, target) {
	const forward = normalizeVector(subtractVectors(target, position));
	const worldUp = [0, 1, 0];
	let right = crossVectors(forward, worldUp);
	right = normalizeVector(right);
	const up = normalizeVector(crossVectors(right, forward));

	return { forward, right, up };
}

function moveCamera(deltaTime) {
	const { forward, right, up } = getCameraBasis(camera.position, camera.target);
	const baseSpeed = 24.0;
	const speedMultiplier = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight') ? 2.25 : 1.0;
	const step = baseSpeed * speedMultiplier * deltaTime;
	const movement = [0, 0, 0];

	if (keysDown.has('KeyW')) {
		movement[0] += forward[0];
		movement[1] += forward[1];
		movement[2] += forward[2];
	}

	if (keysDown.has('KeyS')) {
		movement[0] -= forward[0];
		movement[1] -= forward[1];
		movement[2] -= forward[2];
	}

	if (keysDown.has('KeyA')) {
		movement[0] -= right[0];
		movement[1] -= right[1];
		movement[2] -= right[2];
	}

	if (keysDown.has('KeyD')) {
		movement[0] += right[0];
		movement[1] += right[1];
		movement[2] += right[2];
	}

	if (keysDown.has('Space')) {
		movement[0] += up[0];
		movement[1] += up[1];
		movement[2] += up[2];
	}

	if (keysDown.has('ControlLeft') || keysDown.has('ControlRight')) {
		movement[0] -= up[0];
		movement[1] -= up[1];
		movement[2] -= up[2];
	}

	const movementLength = Math.hypot(movement[0], movement[1], movement[2]);
	if (movementLength > 0) {
		const normalizer = step / movementLength;
		const delta = [movement[0] * normalizer, movement[1] * normalizer, movement[2] * normalizer];
		camera.position = addVectors(camera.position, delta);
		camera.target = addVectors(camera.target, delta);
	}
}

window.addEventListener('keydown', event => {
	if (
		event.code === 'Space' ||
		event.code === 'ControlLeft' ||
		event.code === 'ControlRight'
	) {
		event.preventDefault();
	}
	keysDown.add(event.code);
});

window.addEventListener('keyup', event => {
	keysDown.delete(event.code);
});

window.addEventListener('blur', () => {
	keysDown.clear();
});

function bindAttribute(buffer, location, size) {
	if (location < 0) {
		return;
	}

	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.enableVertexAttribArray(location);
	gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

function resizeCanvas() {
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	const width = Math.floor(canvas.clientWidth * dpr);
	const height = Math.floor(canvas.clientHeight * dpr);

	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}

	gl.viewport(0, 0, canvas.width, canvas.height);
	return { width: canvas.width, height: canvas.height };
}

function drawSky(time, dayFactor, width, height) {
	gl.useProgram(skyProgram);
	gl.disable(gl.DEPTH_TEST);
	gl.disable(gl.CULL_FACE);

	bindAttribute(skyBuffer, skyLocations.position, 2);
	gl.uniform1f(skyLocations.time, time);
	gl.uniform1f(skyLocations.dayFactor, dayFactor);
	gl.uniform2f(skyLocations.resolution, width, height);

	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function drawTerrain(projection, view, cameraPosition, sunDirection, dayFactor) {
	gl.useProgram(terrainProgram);
	gl.enable(gl.DEPTH_TEST);
	gl.enable(gl.CULL_FACE);
	gl.cullFace(gl.BACK);

	bindAttribute(terrainBuffers.position, terrainLocations.position, 3);
	bindAttribute(terrainBuffers.normal, terrainLocations.normal, 3);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainBuffers.index);

	setUniformMatrix(terrainLocations.projection, projection);
	setUniformMatrix(terrainLocations.view, view);
	setUniformMatrix(terrainLocations.model, matrixIdentity());
	setUniformVector(terrainLocations.sunDirection, sunDirection);
	setUniformVector(terrainLocations.cameraPosition, cameraPosition);
	gl.uniform1f(terrainLocations.dayFactor, dayFactor);
	gl.uniform1f(terrainLocations.fogDensity, 0.028);

	gl.drawElements(gl.TRIANGLES, terrain.indices.length, gl.UNSIGNED_SHORT, 0);
}

let lastFrame = performance.now();

function smoothstep(edge0, edge1, value) {
	const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

function frame(now) {
	const deltaTime = Math.min((now - lastFrame) * 0.001, 0.05);
	lastFrame = now;
	moveCamera(deltaTime);

	const { width, height } = resizeCanvas();
	const time = now * 0.001;
	const cycle = (Math.sin(time * 0.18) + 1) * 0.5;
	const dayFactor = Math.pow(smoothstep(0.08, 0.9, cycle), 1.2);
	const lookTarget = camera.target;
	const cameraPosition = camera.position;
	const view = matrixLookAt(cameraPosition, lookTarget, [0, 1, 0]);
	const projection = matrixPerspective(Math.PI / 3.4, width / height, 0.1, 400.0);

	const sunAzimuth = time * 0.07;
	const sunDirection = normalizeVector([
		Math.cos(sunAzimuth),
		0.82 + Math.sin(time * 0.11) * 0.06,
		Math.sin(sunAzimuth),
	]);

	gl.clearColor(0, 0, 0, 1);
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

	drawSky(time, dayFactor, width, height);
	drawTerrain(projection, view, cameraPosition, sunDirection, dayFactor);

	requestAnimationFrame(frame);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
requestAnimationFrame(frame);
