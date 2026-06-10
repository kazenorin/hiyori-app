import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = import.meta.dirname;
const FILES = {
	'package.json': {
		path: join(ROOT, '..', 'package.json'),
		replace: (content, oldVer, newVer) => content.replace(`"version": "${oldVer}"`, `"version": "${newVer}"`),
	},
	'src-tauri/Cargo.toml': {
		path: join(ROOT, '..', 'src-tauri', 'Cargo.toml'),
		replace: (content, oldVer, newVer) => content.replace(`version = "${oldVer}"`, `version = "${newVer}"`),
	},
	'src-tauri/tauri.conf.json': {
		path: join(ROOT, '..', 'src-tauri', 'tauri.conf.json'),
		replace: (content, oldVer, newVer) => content.replace(`"version": "${oldVer}"`, `"version": "${newVer}"`),
	},
	'README.md': {
		path: join(ROOT, '..', 'README.md'),
		replace: (content, oldVer, newVer) =>
			content
				.replaceAll(`BYOA_${oldVer}_amd64.deb`, `BYOA_${newVer}_amd64.deb`)
				.replaceAll(`BYOA-${oldVer}-1.x86_64.rpm`, `BYOA-${newVer}-1.x86_64.rpm`)
				.replaceAll(`BYOA_${oldVer}_x64-setup.exe`, `BYOA_${newVer}_x64-setup.exe`),
	},
};

function getCurrentVersion() {
	const pkg = JSON.parse(readFileSync(FILES['package.json'].path, 'utf-8'));
	return pkg.version;
}

function parseArgs() {
	const args = process.argv.slice(2);
	if (args.length !== 1) {
		const current = getCurrentVersion();
		console.error(`Usage: node scripts/bump-version.mjs <new-version>`);
		console.error(`  Current version: ${current}`);
		console.error(`  Example: node scripts/bump-version.mjs 0.5.0`);
		process.exit(1);
	}
	return args[0];
}

function validateVersion(version) {
	if (!/^\d+\.\d+\.\d+$/.test(version)) {
		console.error(`Error: Invalid version format "${version}". Expected semver (e.g. 0.5.0).`);
		process.exit(1);
	}
}

function bumpFiles(oldVer, newVer) {
	for (const [name, { path, replace }] of Object.entries(FILES)) {
		const content = readFileSync(path, 'utf-8');
		const updated = replace(content, oldVer, newVer);
		if (updated === content) {
			console.warn(`  Warning: no replacement made in ${name}`);
		} else {
			writeFileSync(path, updated, 'utf-8');
			console.log(`  Updated ${name}: ${oldVer} → ${newVer}`);
		}
	}
}

function updatePackageLock() {
	try {
		execSync('npm install --package-lock-only --ignore-scripts', { cwd: join(ROOT, '..'), stdio: 'inherit' });
		console.log('  Updated package-lock.json');
	} catch {
		console.warn('  Warning: npm install --package-lock-only failed. Run it manually if needed.');
	}
}

function updateCargoLock() {
	const cargoTomlDir = join(ROOT, '..', 'src-tauri');
	try {
		execSync('cargo generate-lockfile', { cwd: cargoTomlDir, stdio: 'inherit' });
		console.log('  Updated src-tauri/Cargo.lock');
	} catch {
		console.warn('  Warning: cargo generate-lockfile failed. Run it manually if needed.');
	}
}

function main() {
	const newVer = parseArgs();
	validateVersion(newVer);
	const oldVer = getCurrentVersion();

	if (oldVer === newVer) {
		console.error(`Error: New version is the same as current version (${oldVer}).`);
		process.exit(1);
	}

	console.log(`Bumping version: ${oldVer} → ${newVer}\n`);

	bumpFiles(oldVer, newVer);
	console.log('');
	updatePackageLock();
	updateCargoLock();

	console.log(`\nDone. To commit, run:`);
	console.log(`  git add -A && git commit -m "chore: bump version to ${newVer}"`);
}

main();
