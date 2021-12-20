import { ConfigManagerV2 } from '../src/services/config-manager-v2';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import https from 'https';
import 'jest-extended';

const confV2 = new ConfigManagerV2(path.join(__dirname, '../conf/root.yml'));
const certPath = path.dirname(confV2.get('ssl.certificatePath'));
const host = 'localhost';
const port = confV2.get('server.port');
const ALLOWANCE = 5000000;

let privateKey: string;
if (process.env.ETH_PRIVATE_KEY && process.env.ETH_PRIVATE_KEY !== '') {
  privateKey = process.env.ETH_PRIVATE_KEY;
} else {
  console.log(
    'Please define the env variable ETH_PRIVATE_KEY in order to run the tests.'
  );
  process.exit(1);
}

const sleep = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const httpsAgent = axios.create({
  httpsAgent: new https.Agent({
    ca: fs.readFileSync(certPath.concat('/ca_cert.pem'), {
      encoding: 'utf-8',
    }),
    cert: fs.readFileSync(certPath.concat('/client_cert.pem'), {
      encoding: 'utf-8',
    }),
    key: fs.readFileSync(certPath.concat('/client_key.pem'), {
      encoding: 'utf-8',
    }),
    host: host,
    port: port,
    requestCert: true,
    rejectUnauthorized: false,
  }),
});

type method = 'GET' | 'POST';

export const request = async (
  method: method,
  path: string,
  params: Record<string, any>
) => {
  try {
    let response;
    const gatewayAddress = `https://${host}:${port}`;
    if (method === 'GET') {
      response = await httpsAgent.get(gatewayAddress + path);
    } else {
      params.privateKey = privateKey;
      response = await httpsAgent.post(gatewayAddress + path, params);
    }
    return response.data;
  } catch (err) {
    console.log(`${path} - ${err}`);
  }
};

jest.setTimeout(300000); // run for 5 mins

export const ethTests = async (
  connector: string = '',
  tokens: string[] = []
) => {
  console.log('\nStarting ETH tests');
  console.log('***************************************************');
  console.log('Token symbols used in tests: ', tokens);
  expect(tokens.length).toEqual(3);
  expect(privateKey).toBeDefined();

  // call /
  console.log('Checking status of gateway server...');
  const result = await request('GET', '/', {});
  // confirm expected response
  console.log(result);
  expect(result.status).toEqual('ok');

  // call /balances
  console.log('Checking balances...');
  const balancesResponse = await request('POST', '/eth/balances', {
    tokenSymbols: tokens,
  });
  // confirm and save balances
  const balances = balancesResponse.balances;
  console.log(balances);
  expect(parseFloat(balances.ETH)).toBeGreaterThan(0);

  // call /balances with invalid token symbol
  // confirm expected error message
  console.log('calling balances with invalid token symbols ABC and XYZ...');
  const balancesResponse1 = await request('POST', '/eth/balances', {
    tokenSymbols: ['ABC', 'XYZ'],
  });
  expect(balancesResponse1).toBeUndefined();

  // call /allowances
  // confirm and save allowances
  console.log('checking initial allowances...');
  const allowancesResponse1 = await request('POST', '/eth/allowances', {
    tokenSymbols: tokens,
    spender: connector,
  });
  let allowances = allowancesResponse1.approvals;
  console.log(allowances);

  for (const token of [tokens[0], tokens[1]]) {
    // call /approve on each token
    console.log(`Resetting allowance for ${token} to ${ALLOWANCE}...`);
    const nonce = await request('POST', '/eth/nonce', {});
    console.log(`Nonce: ${nonce.nonce}`);
    const approve1 = await request('POST', '/eth/approve', {
      token: token,
      spender: connector,
      amount: ALLOWANCE.toString(),
      nonce: nonce.nonce,
    });
    console.log(approve1);
    while (allowances[token] !== approve1.amount) {
      console.log(
        'Waiting for atleast 1 block time (i.e 13 secs) to give time for approval to be mined.'
      );
      await sleep(13000);
      // confirm that allowance changed correctly
      console.log('Rechecking allowances to confirm approval...');
      const allowancesResponse2 = await request('POST', '/eth/allowances', {
        tokenSymbols: tokens,
        spender: connector,
      });
      allowances = allowancesResponse2.approvals;
      console.log(allowances);
    }
  }

  // call /approve with invalid spender address
  console.log('Trying to approve for invalid contract...');
  const approve3 = await request('POST', '/eth/approve', {
    token: tokens[0],
    spender: 'nill',
  });
  console.log(approve3);
  // confirm expected error message
  expect(approve3).toBeUndefined();

  // call /approve with invalid token symbol
  console.log('Trying to approve invalid token ABC...');
  const approve4 = await request('POST', '/eth/approve', {
    token: 'ABC',
    spender: connector,
  });
  console.log(approve4);
  // confirm expected error message
  expect(approve4).toBeUndefined();

  // call /approve with invalid amount
  console.log('Trying to approve invalid amount...');
  const approve5 = await request('POST', '/eth/approve', {
    token: tokens[0],
    connector: connector,
    amount: 'number',
  });
  console.log(approve5);
  // confirm expected error message
  expect(approve5).toBeUndefined();
};