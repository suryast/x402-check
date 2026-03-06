import { checkX402 } from './checker.js';
import type { X402Result, ValidationResult, FacilitatorResult } from './types.js';
import chalk from 'chalk';

function printHelp() {
  console.log(`
${chalk.bold.cyan('x402-validate')} — Check if URLs support the x402 payment protocol

${chalk.bold('USAGE')}
  x402-validate [options] <url> [url...]

${chalk.bold('OPTIONS')}
  --json          Machine-readable JSON output
  --timeout <ms>  Request timeout in milliseconds (default: 10000)
  --verbose       Show full headers, schema validation, facilitator check
  --help          Show this help message
  --version       Show version

${chalk.bold('EXIT CODES')}
  0   x402 detected on at least one URL
  1   No x402 detected
  2   Error (network, timeout, invalid args)

${chalk.bold('EXAMPLES')}
  x402-validate https://api.example.com/resource
  x402-validate --json https://api.example.com/resource
  x402-validate --timeout 5000 https://api.example.com/resource
  x402-validate --verbose https://api.example.com/resource
  x402-validate https://a.com/api https://b.com/api

${chalk.gray('Learn more: https://x402.org | https://a2alist.ai')}
`);
}

function printValidation(validation: ValidationResult): void {
  if (validation.valid && validation.warnings.length === 0) {
    console.log(`  ${chalk.bold('Schema:')}      ${chalk.green('✅ Valid')}`);
  } else if (!validation.valid) {
    console.log(`  ${chalk.bold('Schema:')}      ${chalk.red('❌ Invalid')}`);
    for (const err of validation.errors) {
      console.log(`    ${chalk.red('✗')} ${err}`);
    }
  } else {
    console.log(`  ${chalk.bold('Schema:')}      ${chalk.yellow('⚠️  Valid with warnings')}`);
  }
  if (validation.warnings.length > 0) {
    for (const w of validation.warnings) {
      console.log(`    ${chalk.yellow('⚠')} ${w}`);
    }
  }
}

function printFacilitator(fc: FacilitatorResult): void {
  if (fc.reachable) {
    console.log(
      `  ${chalk.bold('Facilitator:')} ${chalk.green('✅ Reachable')} ${chalk.gray(`(HTTP ${fc.status})`)}`
    );
  } else if (fc.error) {
    console.log(
      `  ${chalk.bold('Facilitator:')} ${chalk.yellow('⚠️  Unreachable')} ${chalk.gray(`(${fc.error})`)}`
    );
  } else {
    console.log(
      `  ${chalk.bold('Facilitator:')} ${chalk.yellow('⚠️  Unreachable')} ${chalk.gray(`(HTTP ${fc.status})`)}`
    );
  }
  console.log(`  ${chalk.bold('Fac URL:')}     ${chalk.gray(fc.url)}`);
}

function formatPayment(result: X402Result, verbose: boolean): void {
  const { url, status, supported, paymentDetails, error, headers, schemaValidation, facilitatorCheck } = result;

  if (supported && paymentDetails) {
    const source = status === 402 ? '' : chalk.cyan(' (via .well-known/x402.json)');
    console.log(`\n${chalk.bold.green('✅ x402 DETECTED')}${source} ${chalk.gray(url)}`);
    console.log(`  ${chalk.bold('Status:')}      ${chalk.yellow(String(status))}`);

    // New spec: shows accepts array
    if (paymentDetails.accepts && paymentDetails.accepts.length > 0) {
      for (const [i, entry] of paymentDetails.accepts.entries()) {
        const prefix = paymentDetails.accepts.length > 1 ? ` [${i + 1}]` : '';
        console.log(`  ${chalk.bold(`Network${prefix}:`)}   ${entry.network}`);
        console.log(`  ${chalk.bold(`Scheme${prefix}:`)}    ${entry.scheme}`);
        console.log(`  ${chalk.bold(`Amount${prefix}:`)}    ${entry.maxAmountRequired}`);
        if (entry.resource) {
          console.log(`  ${chalk.bold(`Resource${prefix}:`)}  ${entry.resource}`);
        }
        if (entry.description) {
          console.log(`  ${chalk.bold(`Desc${prefix}:`)}      ${entry.description}`);
        }
        if (entry.payTo) {
          console.log(`  ${chalk.bold(`Pay to${prefix}:`)}   ${chalk.magenta(String(entry.payTo))}`);
        }
      }
      if (paymentDetails.facilitatorUrl) {
        console.log(`  ${chalk.bold('Facilitator:')} ${chalk.gray(paymentDetails.facilitatorUrl)}`);
      }
    } else {
      // Legacy flat structure
      if (paymentDetails.network) console.log(`  ${chalk.bold('Network:')}     ${paymentDetails.network}`);
      if (paymentDetails.scheme)  console.log(`  ${chalk.bold('Scheme:')}      ${paymentDetails.scheme}`);
      if (paymentDetails.maxAmountRequired) console.log(`  ${chalk.bold('Amount:')}      ${paymentDetails.maxAmountRequired}`);
      if (paymentDetails.resource) console.log(`  ${chalk.bold('Resource:')}    ${paymentDetails.resource}`);
      if (paymentDetails.description) {
        console.log(`  ${chalk.bold('Description:')} ${paymentDetails.description}`);
      }
      if (paymentDetails.payTo && Array.isArray(paymentDetails.payTo) && paymentDetails.payTo.length > 0) {
        console.log(`  ${chalk.bold('Pay to:')}`);
        for (const p of paymentDetails.payTo) {
          const tokenInfo = p.token ? ` (${p.token})` : '';
          console.log(`    ${chalk.magenta(p.address)} — ${p.amount}${tokenInfo}`);
        }
      }
    }

    // Schema validation (always shown when supported)
    if (verbose && schemaValidation) {
      printValidation(schemaValidation);
    } else if (schemaValidation && !schemaValidation.valid) {
      console.log(`  ${chalk.bold('Schema:')}      ${chalk.yellow('⚠️  Payload has schema issues (use --verbose to see)')}`);
    }

    // Facilitator check
    if (verbose && facilitatorCheck) {
      printFacilitator(facilitatorCheck);
    }

  } else if (status === 0) {
    console.log(`\n${chalk.bold.red('❌ ERROR')} ${chalk.gray(url)}`);
    console.log(`  ${chalk.red(error ?? 'Unknown error')}`);

  } else if (status === 402) {
    console.log(`\n${chalk.bold.yellow('⚠️  HTTP 402 (no x402 header)')} ${chalk.gray(url)}`);
    if (error) console.log(`  ${chalk.gray(error)}`);

  } else {
    console.log(`\n${chalk.bold.red('❌')} ${chalk.gray(`HTTP ${status} — x402 not detected`)} ${chalk.gray(url)}`);
  }

  if (verbose && headers) {
    console.log(`\n  ${chalk.bold('Headers:')}`);
    for (const [k, v] of Object.entries(headers)) {
      console.log(`    ${chalk.cyan(k)}: ${v}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    try {
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      const pkg = require('../package.json') as { version: string };
      console.log(pkg.version);
    } catch {
      console.log('1.1.0');
    }
    process.exit(0);
  }

  const jsonMode = args.includes('--json');
  const verboseMode = args.includes('--verbose');

  let timeout = 10000;
  const timeoutIdx = args.indexOf('--timeout');
  if (timeoutIdx !== -1) {
    const val = parseInt(args[timeoutIdx + 1] ?? '', 10);
    if (isNaN(val) || val <= 0) {
      console.error(chalk.red('--timeout must be a positive integer (milliseconds)'));
      process.exit(2);
    }
    timeout = val;
  }

  const urls = args.filter(
    (a, i) =>
      !a.startsWith('-') &&
      (a.startsWith('http://') || a.startsWith('https://')) &&
      args[i - 1] !== '--timeout'
  );

  const uniqueUrls = [...new Set(urls)];

  if (uniqueUrls.length === 0) {
    console.error(chalk.red('Error: at least one URL is required.\n'));
    printHelp();
    process.exit(2);
  }

  const results = await Promise.all(
    uniqueUrls.map((url) =>
      checkX402(url, {
        timeout,
        verbose: verboseMode,
        checkFacilitator: verboseMode,
      })
    )
  );

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      formatPayment(r, verboseMode);
    }
    console.log('');
  }

  const anySupported = results.some((r) => r.supported);
  const anyError = results.some((r) => r.status === 0);

  if (anySupported) process.exit(0);
  if (anyError && !anySupported) process.exit(2);
  process.exit(1);
}

main().catch((err) => {
  console.error(chalk.red('Fatal:'), err);
  process.exit(2);
});
