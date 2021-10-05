import { EXTENSION_PNG, EXTENSION_MP4 } from '../helpers/constants';
import path from 'path';
import {
  createConfig,
  loadCandyProgram,
  loadWalletKey,
} from '../helpers/accounts';
import { PublicKey } from '@solana/web3.js';
import fs from 'fs';
import BN from 'bn.js';
import { loadCache, saveCache } from '../helpers/cache';
import log from 'loglevel';
import { arweaveUpload } from '../helpers/upload/arweave';
import { ipfsCreds, ipfsUpload } from '../helpers/upload/ipfs';
import { chunks } from '../helpers/various';

export async function upload(
  files: string[],
  cacheName: string,
  env: string,
  keypair: string,
  totalNFTs: number,
  storage: string,
  retainAuthority: boolean,
  ipfsCredentials: ipfsCreds,
): Promise<boolean> {
  let uploadSuccessful = true;

  const savedContent = loadCache(cacheName, env);
  const cacheContent = savedContent || {};

  if (!cacheContent.program) {
    cacheContent.program = {};
  }

  let existingInCache = [];
  if (!cacheContent.items) {
    cacheContent.items = {};
  } else {
    existingInCache = Object.keys(cacheContent.items);
  }
  if (!cacheContent.videos) {
    cacheContent.videos = {};
  } else {
    existingInCache = Object.keys(cacheContent.videos);
  }

  const seen = {};
  const newFiles = [];

  const seenVideos = {};
  const newVideoFiles = [];

  files.forEach(f => {
    if (!seen[f.replace(EXTENSION_PNG, '').split('/').pop()]) {
      seen[f.replace(EXTENSION_PNG, '').split('/').pop()] = true;
      newFiles.push(f);
    }
    if (!seenVideos[f.replace(EXTENSION_MP4, '').split('/').pop()]) {
      seenVideos[f.replace(EXTENSION_MP4, '').split('/').pop()] = true;
      newVideoFiles.push(f);
    }
  });
  existingInCache.forEach(f => {
    if (!seen[f]) {
      seen[f] = true;
      newFiles.push(f + '.png');
    }
    if (!seenVideos[f]) {
      seenVideos[f] = true;
      newVideoFiles.push(f + '.mp4');
    }
  });

  // console.log('newFiles', newFiles);
  // console.log('newVideoFiles', newVideoFiles);

  const images = newFiles.filter(val => path.extname(val) === EXTENSION_PNG);
  const SIZE = images.length;

  const videos = newVideoFiles.filter(val => path.extname(val) === EXTENSION_MP4);
  const VIDEO_SIZE = videos.length;

  // console.log(images, videos);

  const walletKeyPair = loadWalletKey(keypair);
  const anchorProgram = await loadCandyProgram(walletKeyPair, env);

  let config = cacheContent.program.config
    ? new PublicKey(cacheContent.program.config)
    : undefined;

  for (let i = 0; i < SIZE; i++) {
    const image = images[i];
    const video = videos[i];
    const imageName = path.basename(image);
    const index = imageName.replace(EXTENSION_PNG, '');

    // log.debug(`Processing file: ${i}`);
    // if (i % 50 === 0) {
    //   log.info(`Processing file: ${i}`);
    // }

    let link = cacheContent?.items?.[index]?.link;
    if (!link || !cacheContent.program.uuid) {
      const manifestPath = image.replace(EXTENSION_PNG, '.json');
      const manifestContent = fs
        .readFileSync(manifestPath)
        .toString()
        .replace(imageName, 'image.png')
        .replace(imageName, 'image.png');
      const manifest = JSON.parse(manifestContent);

      const manifestBuffer = Buffer.from(JSON.stringify(manifest));

      if (i === 0 && !cacheContent.program.uuid) {
        // initialize config
        log.info(`initializing config`);
        try {
          const res = await createConfig(anchorProgram, walletKeyPair, {
            maxNumberOfLines: new BN(totalNFTs),
            symbol: manifest.symbol,
            sellerFeeBasisPoints: manifest.seller_fee_basis_points,
            isMutable: true,
            maxSupply: new BN(0),
            retainAuthority: retainAuthority,
            creators: manifest.properties.creators.map(creator => {
              return {
                address: new PublicKey(creator.address),
                verified: true,
                share: creator.share,
              };
            }),
          });
          cacheContent.program.uuid = res.uuid;
          cacheContent.program.config = res.config.toBase58();
          config = res.config;

          log.info(
            `initialized config for a candy machine with publickey: ${res.config.toBase58()}`,
          );

          saveCache(cacheName, env, cacheContent);
        } catch (exx) {
          log.error('Error deploying config to Solana network.', exx);
          throw exx;
        }
      }

      if (!link) {
        try {
          if (storage === 'arweave') {
            // console.log('image', image);
            // console.log('video', video);
            link = await arweaveUpload(
              walletKeyPair,
              anchorProgram,
              env,
              image,
              video,
              manifestBuffer,
              manifest,
              index,
            );
          } else if (storage === 'ipfs') {
            link = await ipfsUpload(ipfsCredentials, image, manifestBuffer);
          }

          if (link) {
            log.debug('setting cache for ', index);
            cacheContent.items[index] = {
              link,
              name: manifest.name,
              onChain: false,
            };
            cacheContent.authority = walletKeyPair.publicKey.toBase58();
            saveCache(cacheName, env, cacheContent);
          }
        } catch (er) {
          uploadSuccessful = false;
          log.error(`Error uploading file ${index}`, er);
        }
      }
    }
  }
  // repeat image uploads for videos
  // for (let i = 0; i < VIDEO_SIZE; i++) {
  //   // console.log('video upload running')
  //   const video = videos[i];
  //   const videoName = path.basename(video);
  //   const index = videoName.replace(EXTENSION_MP4, '');

  //   log.debug(`Processing file: ${i}`);
  //   if (i % 50 === 0) {
  //     log.info(`Processing file: ${i}`);
  //   }

  //   let link = cacheContent?.videos?.[index]?.link;
  //   // console.log('link', link)
  //   if (!link || !cacheContent.program.uuid) {
  //     const manifestPath = video.replace(EXTENSION_MP4, '.json');
  //     console.log('videoName', videoName);
  //     const manifestContent = fs
  //       .readFileSync(manifestPath)
  //       .toString()
  //       .replace(videoName, 'video.mp4')
  //       .replace(videoName, 'video.mp4');
  //     const manifest = JSON.parse(manifestContent);

  //     const manifestBuffer = Buffer.from(JSON.stringify(manifest));

  //     if (!link) {
  //       try {
  //         if (storage === 'arweave') {
  //           link = await arweaveVideoUpload(
  //             walletKeyPair,
  //             anchorProgram,
  //             env,
  //             video,
  //             manifestBuffer,
  //             manifest,
  //             index,
  //           );
  //         } else if (storage === 'ipfs') {
  //           link = await ipfsUpload(ipfsCredentials, video, manifestBuffer);
  //         }

  //         if (link) {
  //           log.debug('setting cache for ', index);
  //           cacheContent.videos[index] = {
  //             link,
  //             name: manifest.name,
  //             onChain: false,
  //           };
  //           cacheContent.authority = walletKeyPair.publicKey.toBase58();
  //           saveCache(cacheName, env, cacheContent);
  //         }
  //       } catch (er) {
  //         uploadSuccessful = false;
  //         log.error(`Error uploading file ${index}`, er);
  //       }
  //     }
  //   }
  // }

  const keys = Object.keys(cacheContent.items);
  try {
    await Promise.all(
      chunks(Array.from(Array(keys.length).keys()), 1000).map(
        async allIndexesInSlice => {
          for (
            let offset = 0;
            offset < allIndexesInSlice.length;
            offset += 10
          ) {
            const indexes = allIndexesInSlice.slice(offset, offset + 10);
            const onChain = indexes.filter(i => {
              const index = keys[i];
              return cacheContent.items[index]?.onChain || false;
            });
            const ind = keys[indexes[0]];

            if (onChain.length != indexes.length) {
              log.info(
                `Writing indices ${ind}-${keys[indexes[indexes.length - 1]]}`,
              );
              try {
                await anchorProgram.rpc.addConfigLines(
                  ind,
                  indexes.map(i => ({
                    uri: cacheContent.items[keys[i]].link,
                    name: cacheContent.items[keys[i]].name,
                  })),
                  {
                    accounts: {
                      config,
                      authority: walletKeyPair.publicKey,
                    },
                    signers: [walletKeyPair],
                  },
                );
                indexes.forEach(i => {
                  cacheContent.items[keys[i]] = {
                    ...cacheContent.items[keys[i]],
                    onChain: true,
                  };
                });
                saveCache(cacheName, env, cacheContent);
              } catch (e) {
                log.error(
                  `saving config line ${ind}-${
                    keys[indexes[indexes.length - 1]]
                  } failed`,
                  e,
                );
                uploadSuccessful = false;
              }
            }
          }
        },
      ),
    );
  } catch (e) {
    log.error(e);
  } finally {
    saveCache(cacheName, env, cacheContent);
  }

  // const videoKeys = Object.keys(cacheContent.videos);
  // try {
  //   await Promise.all(
  //     chunks(Array.from(Array(videoKeys.length).keys()), 1000).map(
  //       async allIndexesInSlice => {
  //         for (
  //           let offset = 0;
  //           offset < allIndexesInSlice.length;
  //           offset += 10
  //         ) {
  //           const indexes = allIndexesInSlice.slice(offset, offset + 10);
  //           const onChain = indexes.filter(i => {
  //             const index = videoKeys[i];
  //             return cacheContent.videos[index]?.onChain || false;
  //           });
  //           const ind = videoKeys[indexes[0]];

  //           if (onChain.length != indexes.length) {
  //             log.info(
  //               `Writing indices ${ind}-${videoKeys[indexes[indexes.length - 1]]}`,
  //             );
  //             try {
  //               await anchorProgram.rpc.addConfigLines(
  //                 ind,
  //                 indexes.map(i => ({
  //                   uri: cacheContent.videos[videoKeys[i]].link,
  //                   name: cacheContent.videos[videoKeys[i]].name,
  //                 })),
  //                 {
  //                   accounts: {
  //                     config,
  //                     authority: walletKeyPair.publicKey,
  //                   },
  //                   signers: [walletKeyPair],
  //                 },
  //               );
  //               indexes.forEach(i => {
  //                 cacheContent.videos[videoKeys[i]] = {
  //                   ...cacheContent.videos[videoKeys[i]],
  //                   onChain: true,
  //                 };
  //               });
  //               saveCache(cacheName, env, cacheContent);
  //             } catch (e) {
  //               log.error(
  //                 `saving config line ${ind}-${
  //                   videoKeys[indexes[indexes.length - 1]]
  //                 } failed`,
  //                 e,
  //               );
  //               uploadSuccessful = false;
  //             }
  //           }
  //         }
  //       },
  //     ),
  //   );
  // } catch (e) {
  //   log.error(e);
  // } finally {
  //   saveCache(cacheName, env, cacheContent);
  // }
  console.log(`Done. Successful = ${uploadSuccessful}.`);
  return uploadSuccessful;
}
