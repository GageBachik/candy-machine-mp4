import * as anchor from '@project-serum/anchor';
import FormData from 'form-data';
import fs from 'fs';
import log from 'loglevel';
import fetch from 'node-fetch';
import { ARWEAVE_PAYMENT_WALLET } from '../constants';
import { sendTransactionWithRetryWithKeypair } from '../transactions';

async function upload(data: FormData, manifest, index) {
  log.debug(`trying to upload ${index}.png: ${manifest.name}`);
  return await (
    await fetch(
      'https://us-central1-principal-lane-200702.cloudfunctions.net/uploadFile4',
      {
        method: 'POST',
        // @ts-ignore
        body: data,
      },
    )
  ).json();
}

export async function arweaveUpload(
  walletKeyPair,
  anchorProgram,
  env,
  image,
  video,
  manifestBuffer,
  manifest,
  index,
) {
  const storageCost = 10;

  const instructions = [
    anchor.web3.SystemProgram.transfer({
      fromPubkey: walletKeyPair.publicKey,
      toPubkey: ARWEAVE_PAYMENT_WALLET,
      lamports: storageCost,
    }),
  ];

  const tx = await sendTransactionWithRetryWithKeypair(
    anchorProgram.provider.connection,
    walletKeyPair,
    instructions,
    [],
    'single',
  );
  log.debug('transaction for arweave payment:', tx);

  const data = new FormData();
  data.append('transaction', tx['txid']);
  data.append('env', env);
  data.append('file[]', fs.createReadStream(image), {
    filename: `image.png`,
    contentType: 'image/png',
  });
  data.append('file[]', fs.createReadStream(video), {
    filename: `video.mp4`,
    contentType: 'video/mp4',
  });
  data.append('file[]', manifestBuffer, 'metadata.json');

  const result = await upload(data, manifest, index);

  const metadataFile = result.messages?.find(
    m => m.filename === 'manifest.json',
  );
  if (metadataFile?.transactionId) {
    const link = `https://arweave.net/${metadataFile.transactionId}`;
    log.debug(`File uploaded: ${link}`);
    // console.log(`Image File uploaded: ${link}`);
    return link;
  } else {
    // @todo improve
    throw new Error(`No transaction ID for upload: ${index}`);
  }
}

// export async function arweaveVideoUpload(
//   walletKeyPair,
//   anchorProgram,
//   env,
//   video,
//   manifestBuffer,
//   manifest,
//   index,
// ) {
//   const storageCost = 10;

//   const instructions = [
//     anchor.web3.SystemProgram.transfer({
//       fromPubkey: walletKeyPair.publicKey,
//       toPubkey: ARWEAVE_PAYMENT_WALLET,
//       lamports: storageCost,
//     }),
//   ];

//   const tx = await sendTransactionWithRetryWithKeypair(
//     anchorProgram.provider.connection,
//     walletKeyPair,
//     instructions,
//     [],
//     'single',
//   );
//   log.debug('transaction for arweave payment:', tx);

//   const data = new FormData();
//   data.append('transaction', tx['txid']);
//   data.append('env', env);
//   data.append('file[]', fs.createReadStream(video), {
//     filename: `video.mp4`,
//     contentType: 'video/mp4',
//   });
//   data.append('file[]', manifestBuffer, 'metadata.json');

//   const result = await upload(data, manifest, index);

//   const metadataFile = result.messages?.find(
//     m => m.filename === 'manifest.json',
//   );
//   if (metadataFile?.transactionId) {
//     const link = `https://arweave.net/${metadataFile.transactionId}`;
//     log.debug(`File uploaded: ${link}`);
//     console.log(`Video File uploaded: ${link}`);
//     return link;
//   } else {
//     // @todo improve
//     throw new Error(`No transaction ID for upload: ${index}`);
//   }
// }
