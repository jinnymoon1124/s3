const AWS = require('aws-sdk');
const sharp = require('sharp');
const JSZip = require('jszip');

const s3 = new AWS.S3();
const cloudFront = new AWS.CloudFront();

exports.handler = async (event, context, callback) => {
  console.log("start handler");

  const ALLOWED_IMAGE_MIME_TYPE = [
    "image/jpeg",     // JPEG, JPG
    "image/png",      // PNG
    "image/webp",     // WebP
    "image/avif",     // AVIF
    // "image/gif",      // GIF, 애니메이션 효과 사라지는 이슈
    //"image/svg+xml",  // SVG, 용량 증가 및 인코딩 깨짐 현상으로 제외
    "image/tiff",     // TIFF, TIF 
  ];

  const bucketName = event.Records[0].s3.bucket.name;
  const filepath = event.Records[0].s3.object.key.replaceAll("+", " ");
  console.log(` : filepath = ${filepath}`);
  const zippedFilePath = `${filepath}`;

  const tags = await readTag(bucketName, filepath);
  
  if(Array.isArray(tags) && tags.length > 0) {
    var index = tags.findIndex(tag => tag.Key == "writer" && tag.Value == "lambda");
    if(index != -1) {
      console.log("stop handler: this object created by lambda");
      return callback(null, null);
    }
  }

  console.log("continue handler: this object created by users");
  
  const originalObject = await readImage(bucketName, filepath);
  const contentType = originalObject.ContentType;

  if(!ALLOWED_IMAGE_MIME_TYPE.includes(contentType)) {
    console.log(`stop handler: contentType ${contentType} is not allowed`);
    return callback(null, null);
  }

  console.log(`continue handler: contentType ${contentType} is allowed`);

  const originalImage = originalObject.Body;

  // // gif 파일은 압축 및 이름 변경 X >> 우선 가능하지 않은 파일 타입으로 해뒀는데 
  // if (contentType === "image/gif") {
  //   const originalFilename = filepath.split('/').pop();
  //   const newFilename = `${originalFilename}`;
  //   await saveImageToS3(bucketName, newFilename, originalImage, contentType);
  //   console.log("this file is gif");
  //   return callback(null, null);
  // } else {
    // 파일명 변경해서 재저장
    const originalFilename = filepath.split('/').pop();
    const newFilename = `origin/origin_${originalFilename}`;
    await saveImageToS3(bucketName, newFilename, originalImage, contentType);
  // }


  // 이미지 형식이 webp이면 다시 압축 X 
  // if (contentType === "image/webp") {
  //   // 원본 이미지만 업로드하고 압축하지 않음
  //   await uploadFile(bucketName, filepath, originalImage, contentType);
  // } else {
    // 다른 이미지 형식인 경우, 이미지 압축 후 업로드
    const resizedImage = await resizeImage(originalImage, 'webp', { quality: 85 });
    await uploadFile(bucketName, zippedFilePath, resizedImage, contentType);
  // }

  // await deleteOriginImage(bucketName, filepath);

  // 잠시 cloudfront는 주석처리
  /*
  //별칭 도메인을 기준으로 CloudFront ID 찾기
  const hostname = "https://cdn.hackers.com";

  console.log(`start getDistributeId: ${hostname}`);
  const distributionId = await getDistributeId(hostname);
  */
  // const distributionId = "E1QYQ9O4GI78C4";
  // //console.log(`finish getDistributeId: ${hostname}`);
  
  // if(distributionId == '') {
  //   console.log(` : distributionId empty.`);
  // } else {
  //   console.log(` : distributionId confirm ${distributionId}.`);
  //   const res = await createInvalidation(distributionId, filepath);
  //   const id = res.Invalidation.Id;
  //   if(id !== '') {
  //     const CallerReference = res.Invalidation.InvalidationBatch.CallerReference;
  //     const status = res.Invalidation.Status;
  //     console.log(`succeed createInvalidation: id=${id}/callerReference=${status}/status=${status}`);
  //   } else {
  //     console.log(`failed createInvalidation`);
  //   }
  // }

  console.log("finish handler");

  return callback(null, zippedFilePath);
};

////////////////////////////////////////////////////////////////////////

/**
 * @param {string} bucketName
 * @param {string} key
 */ 
async function readTag(bucketName, key) {
  console.log(`start readTag: ${bucketName}/${key}`);

  const s3ObjectTagging = await s3
    .getObjectTagging({ Bucket: bucketName, Key: key })
    .promise();

  console.log(`finish readTag: ${bucketName}/${key}`);

  return s3ObjectTagging.TagSet;
}

/**
 * @param {string} bucketName 
 * @param {string} key 
 */
async function readImage(bucketName, key) {
  console.log(`start readImage: ${bucketName}/${key}`);

  const s3Object = await s3
    .getObject({ Bucket: bucketName, Key: key })
    .promise();

  console.log(`finish readImage: ${bucketName}/${key}`);

  return s3Object;
}

/**
 * @param {Buffer} image 
 * @param {string} format
 * @param {object?} options
 * @returns {Buffer}
 */
async function resizeImage(image, format, options) {
  console.log(`start resizeImage`);

  const resizedImage = await sharp(image, {animated: true, failOn: "truncated"})
    .toFormat(format, options)
    .toBuffer();

  console.log(`finish resizeImage`);

  return resizedImage;
}

// 파일 타입이 webp 일 때 tagging만 진행한 뒤 그대로 업로드 (압축 X)
async function uploadFile(bucketName, key, data, contentType) {
  console.log(`start uploadFile: ${bucketName}/${key}`);

  try {
    await s3
      .putObject({
        Bucket: bucketName,
        Key: key,
        Body: data,
        Tagging: 'writer=lambda',
        ContentType: contentType
      })
      .promise();

    console.log(`finish uploadFile: ${bucketName}/${key}`);
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

// 원본 파일 압축 X / 파일 명 수정 및 tag 추가 후 재저장
async function saveImageToS3(bucketName, key, data, contentType) {
  console.log(`start saveImageToS3: ${bucketName}/origin/${key}`);

  try {
    await s3
      .putObject({
        Bucket: bucketName,
        Key: key,
        Body: data,
        Tagging: 'writer=lambda',
        ContentType: contentType
      })
      .promise();

    console.log(`finish saveImageToS3: ${bucketName}/origin/${key}`);
  } catch (error) {
    console.error('Error saving image to S3:', error);
    throw error;
  }
}


//zip
/**
 * @param {Buffer} image 
 */
function zipImage(image) {
  const zip = new JSZip();

  console.log(`start zipImage`);

  zip.file('image.jpg', image);

  console.log(`finish zipImage`);

  return zip.generateAsync({ type: 'nodebuffer' });
}

async function uploadZipFile(bucketName, key, data, contentType) {
  console.log(`start uploadZipFile: ${bucketName}/${key}`);

  try {
    await s3
      .putObject({
        Bucket: bucketName,
        Key: key,
        Body: data,
        Tagging: 'writer=lambda',
        ContentType: contentType
      })
      .promise();

    console.log(`finish uploadZipFile: ${bucketName}/${key}`);
  } catch (error) {
    console.error('Error uploading zip file:', error);
    throw error; // 에러를 다시 throw하여 호출자에게 전달
  }
}

async function deleteOriginImage(bucketName, key) {
  console.log(`start deleteOriginImage: ${bucketName}/${key}`);

  await s3.deleteObject({ Bucket: bucketName, Key: key }).promise();

  console.log(`finish deleteOriginImage: ${bucketName}/${key}`);
}

//별칭 도메인을 기준으로 CloudFront ID 찾기
async function getDistributeId(hostname){
  const {DistributionList} = await cloudFront.listDistributions().promise();

  for(let distributionObject of DistributionList.Items){
      if(distributionObject.Aliases.Items.includes(hostname) == true){
          return distributionObject.Id;
      }
  };
}

async function createInvalidation(distributionId, key) {
  console.log(`start createInvalidation: ${key}`);

  const timestamp = Date.now().toString();
  const item = "/" + key;
  console.log(` : item = ${item}`);

  var params = {
    DistributionId: distributionId, // The distribution's id.
    InvalidationBatch: {
      CallerReference: timestamp, // A value that you specify to uniquely identify an invalidation request.
      Paths: {
        Quantity: 1, // The number of invalidation paths specified for the objects that you want to invalidate.
        Items: [ // A complex type that contains a list of the paths that you want to invalidate.
          item
        ]
      }
    }
  };
 
  const response = await cloudFront.createInvalidation(params).promise();
  console.log(`finish createInvalidation: ${key}`);
  return response;
}