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
attribute vec2 aUv;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vHeight;
varying vec2 vUv;

void main() {
	vec4 worldPosition = uModel * vec4(aPosition, 1.0);
	vWorldPosition = worldPosition.xyz;
	vNormal = mat3(uModel) * aNormal;
	vHeight = aPosition.y;
	gl_Position = uProjection * uView * worldPosition;
	vUv = aUv;
}
`;

const terrainFragmentSource = `
precision mediump float;

uniform vec3 uSunDirection;
uniform vec3 uCameraPosition;
uniform float uDayFactor;
uniform float uFogDensity;
uniform sampler2D uGrass;
uniform sampler2D uStone;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vHeight;
varying vec2 vUv;

float saturate(float value) {
	return clamp(value, 0.0, 1.0);
}

void main() {
	vec3 normal = normalize(vNormal);
	vec3 lightDir = normalize(uSunDirection);
	float diffuse = max(dot(normal, lightDir), 0.0);
	float backLight = max(dot(normal, normalize(vec3(-0.35, 0.7, 0.45))), 0.0);
	float heightBlend = smoothstep(-14.0, 34.0, vHeight);
	float slopeDarken = 1.0 - saturate(normal.y) * 0.45;

	float stoneMask = smoothstep(-25.0, 10.0, vHeight);
	float grassMask = 1.0 - stoneMask;

	vec3 grass = vec3(0.18, 0.42, 0.18);
	vec3 stone = vec3(0.45, 0.45, 0.48);

	// добавим лёгкую “грязь”, чтобы не было пластика
	float noise = fract(sin(dot(vWorldPosition.xz, vec2(12.9898, 78.233))) * 43758.5453);
	grass += (noise - 0.5) * 0.03;
	stone += (noise - 0.5) * 0.02;

	vec3 baseColor = mix(grass, stone, stoneMask);

	float ambient = mix(0.35, 0.14, 1.0 - uDayFactor);
	vec3 lightColor = mix(vec3(1.2, 1.05, 0.95), vec3(0.55, 0.7, 1.0), 1.0 - uDayFactor);
	vec3 litColor = baseColor * (ambient + diffuse * 1.2 * uDayFactor + backLight * 0.3);
	litColor += lightColor * 0.05 * pow(diffuse, 2.0);

	// высота камеры не используется — берём world Y
	float fogHeight = vWorldPosition.y;

	// нормализуем (подбирается вручную под твою сцену)
	float fogStart = -5.0;
	float fogEnd = -30.0;

	// линейная маска высоты
	float heightFog = smoothstep(fogStart, fogEnd, fogHeight);

	// экспоненциальная плотность (реалистичнее)
	float fog = 1.0 - exp(-heightFog * 3.2);

	// цвет тумана = небо
	vec3 fogColor = mix(
		vec3(0.10, 0.13, 0.19),
		vec3(0.76, 0.84, 0.93),
		uDayFactor
	);

	// смешивание
	litColor = mix(litColor, fogColor, fog);

	gl_FragColor = vec4(litColor, 1.0);
}
`;

const skyboxVertexSource = `
attribute vec3 aPosition;

uniform mat4 uProjection;
uniform mat4 uView;

varying vec3 vDirection;

void main()
{
   vDirection = aPosition;
	vec4 pos = uProjection * uView * vec4(aPosition, 1.0);
	gl_Position = pos.xyww;
}
`;

const skyboxFragmentSource = `
precision mediump float;

uniform float uDayFactor;

varying vec3 vDirection;

void main()
{
    vec3 dir = normalize(vDirection);
	vec3 absDir = abs(dir);

	bool isTop = dir.y > 0.8;
	bool isBottom = dir.y < -0.8;
	bool isSide = !isTop && !isBottom;

    vec3 dayTop = vec3(0.38, 0.63, 0.94);
    vec3 dayBottom = vec3(0.82, 0.91, 1.0);

    vec3 nightTop = vec3(0.03, 0.05, 0.11);
    vec3 nightBottom = vec3(0.08, 0.10, 0.18);

    vec3 top = mix(nightTop, dayTop, uDayFactor);
    vec3 bottom = mix(nightBottom, dayBottom, uDayFactor);

    vec3 color;
	if (isTop) {
		color = top;
	}
	else if (isBottom) {
		color = bottom;
	}
	else {
		float gradient = smoothstep(-1.0, 1.0, dir.y);
		color = mix(bottom, top, gradient);
	}

    gl_FragColor = vec4(color, 1.0);
}
`;

const spriteVertexSource = `
attribute vec2 aCorner;

uniform vec2 uCenter;
uniform vec2 uSize;

varying vec2 vUv;

void main() {
	vUv = aCorner * 0.5 + 0.5;
	gl_Position = vec4(uCenter + aCorner * uSize, 0.0, 1.0);
}
`;

const spriteFragmentSource = `
precision mediump float;

uniform sampler2D uTexture;
uniform vec4 uTint;

varying vec2 vUv;

void main() {
	vec4 color = texture2D(uTexture, vUv);
	gl_FragColor = vec4(color.rgb * uTint.rgb, color.a * uTint.a);
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

function mix(a, b, t)
{
	return a * (1.0 - t) + b * t;
}

function terrainHeight(x, z)
{
	const continental = fbm(x * 0.32, z * 0.32) * 55.0;

	const biome = fbm(x * 0.05, z * 0.05);
	const mountainZone = smoothstep(0.35, 0.85, biome);

	let depth = (z + 200.0) / 380.0;
	depth = Math.max(0.0, Math.min(1.0, depth));

	const frontDepth = 1.0 - depth;

	const frontBoost = 0.7 + 1.3 * frontDepth;

	const fbm1 = Math.max(fbm(x * 1.4, z * 1.4), 0.0);
	const fbm2 = Math.max(fbm(x * 2.2 + 400.0, z * 2.2 - 400.0), 0.0);
	const fbm3 = fbm(x * 3.0, z * 3.0);

	const frontNoise = Math.max(fbm(x * 0.03 + 777.0, z * 0.03 - 777.0), 0.0);
	const backNoiseShape = Math.max(fbm(x * 0.9, z * 0.9 + 1000.0), 0.0);
	const extremeNoise = Math.max(fbm(x * 0.02 + 3000.0, z * 0.02 - 3000.0), 0.0);
	const baseMountains = Math.pow(fbm1, 2.2) * mountainZone * 150.0 * frontBoost;
	const secondaryMountains = Math.pow(fbm2, 2.4) * 80.0 * frontBoost;
	const ridges = Math.abs(fbm3 - 0.5) * 35.0 * (0.75 + 0.25 * frontDepth);
	const frontSpikes = Math.pow(smoothstep(0.90, 0.99, frontNoise), 5.0) * 220.0 * frontDepth;
	const backMass = smoothstep(0.5, 1.0, depth);
	const backMountains = backMass * Math.pow(backNoiseShape, 2.0) * 120.0;
	const extremeBackMask = smoothstep(0.9, 0.995, extremeNoise);
	const extremeBackMountains = Math.pow(extremeBackMask, 3.0) * backMass * 170.0;
	const height = continental + baseMountains + secondaryMountains + ridges + frontSpikes + backMountains + extremeBackMountains - 55.0;

	return isFinite(height) ? height : 0.0;
}

function buildTerrain(gridSize, worldSize) {
	const verticesPerSide = gridSize + 1;
	const positions = new Float32Array(verticesPerSide * verticesPerSide * 3);
	const normals = new Float32Array(verticesPerSide * verticesPerSide * 3);
	const indices = new Uint16Array(gridSize * gridSize * 6);
	const uvs = new Float32Array(verticesPerSide * verticesPerSide * 2);

	let uvOffset = 0;
	let positionOffset = 0;
	const heights = new Float32Array(verticesPerSide * verticesPerSide);

	for (let z = 0; z < verticesPerSide; z++) {
		const zRatio = z / gridSize;
		for (let x = 0; x < verticesPerSide; x++) {
			const xRatio = x / gridSize;
			const worldX = (xRatio - 0.5) * worldSize + 30;
			const worldZ = (zRatio - 0.5) * worldSize;
			const height = terrainHeight(worldX, worldZ);
			heights[z * verticesPerSide + x] = height;
			positions[positionOffset++] = worldX;
			positions[positionOffset++] = height;
			positions[positionOffset++] = worldZ;
			uvs[uvOffset++] = xRatio * 10.0;
			uvs[uvOffset++] = zRatio * 10.0;
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
const skyboxProgram = createProgram(skyboxVertexSource, skyboxFragmentSource);
const spriteProgram = createProgram(spriteVertexSource, spriteFragmentSource);

const terrainLocations = {
	position: gl.getAttribLocation(terrainProgram, 'aPosition'),
	normal: gl.getAttribLocation(terrainProgram, 'aNormal'),
	uv: gl.getAttribLocation(terrainProgram, 'aUv'),
	projection: gl.getUniformLocation(terrainProgram, 'uProjection'),
	view: gl.getUniformLocation(terrainProgram, 'uView'),
	model: gl.getUniformLocation(terrainProgram, 'uModel'),
	sunDirection: gl.getUniformLocation(terrainProgram, 'uSunDirection'),
	cameraPosition: gl.getUniformLocation(terrainProgram, 'uCameraPosition'),
	dayFactor: gl.getUniformLocation(terrainProgram, 'uDayFactor'),
	grass: gl.getUniformLocation(terrainProgram, 'uGrass'),
	stone: gl.getUniformLocation(terrainProgram, 'uStone'),
};


const skyboxLocations = {
    position:
        gl.getAttribLocation(
            skyboxProgram,
            'aPosition'
        ),

    projection:
        gl.getUniformLocation(
            skyboxProgram,
            'uProjection'
        ),

    view:
        gl.getUniformLocation(
            skyboxProgram,
            'uView'
        ),

    dayFactor:
        gl.getUniformLocation(
            skyboxProgram,
            'uDayFactor'
        ),
};

const spriteLocations = {
	corner: gl.getAttribLocation(spriteProgram, 'aCorner'),
	center: gl.getUniformLocation(spriteProgram, 'uCenter'),
	size: gl.getUniformLocation(spriteProgram, 'uSize'),
	texture: gl.getUniformLocation(spriteProgram, 'uTexture'),
	tint: gl.getUniformLocation(spriteProgram, 'uTint'),
};

const terrain = buildTerrain(120, 380);

const terrainBuffers = {
	position: createBuffer(terrain.positions),
	normal: createBuffer(terrain.normals),
	index: createBuffer(terrain.indices, gl.ELEMENT_ARRAY_BUFFER),
	uv: createBuffer(terrain.uvs),
};

const skyBuffer = createBuffer(new Float32Array([
	-1, -1,
	 1, -1,
	-1,  1,
	 1,  1,
]));

const skyboxVertices = new Float32Array([
    -1,-1,-1,
     1,-1,-1,
     1, 1,-1,
    -1, 1,-1,

    -1,-1, 1,
     1,-1, 1,
     1, 1, 1,
    -1, 1, 1,
].map(v => v * 500.0));

const skyboxIndices = new Uint16Array([
    0,1,2, 0,2,3,
    4,6,5, 4,7,6,

    4,5,1, 4,1,0,
    3,2,6, 3,6,7,

    1,5,6, 1,6,2,
    4,0,3, 4,3,7
]);

const skyboxBuffers = {
    position: createBuffer(skyboxVertices),
    index: createBuffer(
        skyboxIndices,
        gl.ELEMENT_ARRAY_BUFFER
    )
};

const spriteCornersBuffer = skyBuffer;

function createTexture() {
	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	return texture;
}

function uploadTexture(texture, image) {
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
}

function loadTexture(sourceUrl) {
	const texture = createTexture();
	const image = new Image();
	image.decoding = 'async';
	const state = { texture, image, aspect: 1 };
	image.onload = () => {
		state.aspect = image.naturalWidth / image.naturalHeight || 1;
		uploadTexture(texture, image);
	};
	image.src = sourceUrl;
	return state;
}

const sunSprite = loadTexture(new URL('./sun.png', import.meta.url).href);
const moonSprite = loadTexture(new URL('./moon.png', import.meta.url).href);
const grassTex = loadTexture(new URL('./grass.png', import.meta.url).href);
const stoneTex = loadTexture(new URL('./stone.jpg', import.meta.url).href);

const camera = {
    position: [0, 34, 92],
    yaw: 0,
    pitch: 0,
};

const keys = {};

window.addEventListener("keydown", e => {
    keys[e.code] = true;
});

window.addEventListener("keyup", e => {
    keys[e.code] = false;
});

function updateCamera(dt)
{
    let speed = 25;

    if (keys["ShiftLeft"])
        speed *= 3;

    const forward = getCameraForward();

    const right = normalizeVector([
        forward[2],
        0,
        -forward[0]
    ]);

    if (keys["KeyW"])
        camera.position = addVectors(
            camera.position,
            forward.map(v => v * speed * dt)
        );

    if (keys["KeyS"])
        camera.position = addVectors(
            camera.position,
            forward.map(v => -v * speed * dt)
        );

    if (keys["KeyA"])
        camera.position = addVectors(
            camera.position,
            right.map(v => v * speed * dt)
        );

    if (keys["KeyD"])
        camera.position = addVectors(
            camera.position,
            right.map(v => -v * speed * dt)
        );

    if (keys["Space"])
        camera.position[1] += speed * dt;

    if (keys["ControlLeft"])
        camera.position[1] -= speed * dt;
}

canvas.addEventListener("click", () => {
    canvas.requestPointerLock();
});

document.addEventListener("mousemove", e => {

    if (document.pointerLockElement !== canvas)
        return;

    camera.yaw -= e.movementX * 0.002;
    camera.pitch -= e.movementY * 0.002;

    const limit = Math.PI * 0.49;

    camera.pitch = Math.max(
        -limit,
        Math.min(limit, camera.pitch)
    );
});

function getCameraForward() {
	const cosPitch = Math.cos(camera.pitch);
	return normalizeVector([
		Math.sin(camera.yaw) * cosPitch,
		Math.sin(camera.pitch),
		Math.cos(camera.yaw) * cosPitch,
	]);
}

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

function removeRotationFromMatrix(viewMatrix) {
    const m = viewMatrix.slice();

    // обнуляем rotation (3x3 матрицу слева сверху)
    m[0] = 1; m[1] = 0; m[2] = 0;
    m[4] = 0; m[5] = 1; m[6] = 0;
    m[8] = 0; m[9] = 0; m[10] = 1;

    return m;
}

function drawSkybox(projection, view, dayFactor) {
    gl.useProgram(skyboxProgram);

    // ❗ ВАЖНО: skybox НЕ должен использовать depth buffer
    gl.depthMask(false);       // не пишем в depth
    gl.disable(gl.DEPTH_TEST); // не тестируем depth

    gl.disable(gl.CULL_FACE);

    bindAttribute(skyboxBuffers.position, skyboxLocations.position, 3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, skyboxBuffers.index);

    setUniformMatrix(skyboxLocations.projection, projection);

    const skyView = removeRotationFromMatrix(view);
    setUniformMatrix(skyboxLocations.view, skyView);

    gl.uniform1f(skyboxLocations.dayFactor, dayFactor);

    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);

    // ❗ возвращаем обратно состояние (очень важно)
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
}

function drawSprite(sprite, center, sizePx, tint) {
	if (!sprite.image.complete || sprite.image.naturalWidth === 0) {
		return;
	}

	gl.useProgram(spriteProgram);
	gl.enable(gl.DEPTH_TEST);
	gl.disable(gl.CULL_FACE);
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

	bindAttribute(spriteCornersBuffer, spriteLocations.corner, 2);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, sprite.texture);
	gl.uniform1i(spriteLocations.texture, 0);
	gl.uniform2f(spriteLocations.center, center[0], center[1]);
	gl.uniform2f(spriteLocations.size, sizePx[0] * sprite.aspect, sizePx[1]);
	gl.uniform4f(spriteLocations.tint, tint[0], tint[1], tint[2], tint[3]);

	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	gl.disable(gl.BLEND);
}

function drawTerrain(projection, view, cameraPosition, sunDirection, dayFactor) {
	gl.useProgram(terrainProgram);
	gl.depthFunc(gl.LEQUAL);
	gl.disable(gl.DEPTH_TEST);
	gl.enable(gl.CULL_FACE);
	gl.cullFace(gl.BACK);

	bindAttribute(terrainBuffers.position, terrainLocations.position, 3);
	bindAttribute(terrainBuffers.normal, terrainLocations.normal, 3);
	bindAttribute(terrainBuffers.uv, terrainLocations.uv, 2);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainBuffers.index);

	setUniformMatrix(terrainLocations.projection, projection);
	setUniformMatrix(terrainLocations.view, view);
	setUniformMatrix(terrainLocations.model, matrixIdentity());
	setUniformVector(terrainLocations.sunDirection, sunDirection);
	setUniformVector(terrainLocations.cameraPosition, cameraPosition);
	gl.uniform1f(terrainLocations.dayFactor, dayFactor);

	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, grassTex.texture);
	gl.uniform1i(terrainLocations.grass, 0);

	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D, stoneTex.texture);
	gl.uniform1i(terrainLocations.stone, 1);

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
	updateCamera(deltaTime);

	const { width, height } = resizeCanvas();
	const time = now * 0.001;
	const cycleAngle = time * 0.18 - Math.PI * 0.5;
	const cycle = (Math.sin(cycleAngle) + 1) * 0.5;
	const dayFactor = Math.pow(smoothstep(0.12, 0.88, cycle), 1.15);
	const cameraPosition = camera.position;
	const forward = getCameraForward();
	const target = addVectors(cameraPosition, forward);
	const view = matrixLookAt(cameraPosition, target, [0, 1, 0]);
	const projection = matrixPerspective(Math.PI / 3.4, width / height, 0.1, 400.0);

	const sunAzimuth = cycleAngle;
	const sunDirection = normalizeVector([
		Math.cos(sunAzimuth),
		Math.sin(sunAzimuth) * 0.75 + 0.35,
		Math.sin(sunAzimuth),
	]);

	const sunCenter = [
		0.5 + Math.cos(cycleAngle) * 0.34,
		0.5 + Math.sin(cycleAngle) * 0.34,
	];
	const moonAngle = cycleAngle + Math.PI;
	const moonCenter = [
		0.5 + Math.cos(moonAngle) * 0.34,
		0.5 + Math.sin(moonAngle) * 0.34,
	];
	const spriteWidth = 96 / width * 2;
	const spriteHeight = 96 / height * 2;

	gl.clearColor(0, 0, 0, 1);
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

	drawSkybox(
		projection,
		view,
		dayFactor
	);
	drawSprite(sunSprite, [sunCenter[0] * 2 - 1, sunCenter[1] * 2 - 1], [spriteWidth, spriteHeight], [1, 1, 1, dayFactor]);
	drawSprite(moonSprite, [moonCenter[0] * 2 - 1, moonCenter[1] * 2 - 1], [spriteWidth * 0.84, spriteHeight * 0.84], [1, 1, 1, 1.0 - dayFactor]);
	drawTerrain(projection, view, cameraPosition, sunDirection, dayFactor);

	requestAnimationFrame(frame);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
requestAnimationFrame(frame);
