const AWS = require('aws-sdk');
const sharp = require('sharp');
const JSZip = require('jszip');
const s3 = new AWS.S3();

exports.handler = async (event, context, callback) => {
  console.log("start handler");

  const ALLOWED_IMAGE_MIME_TYPE = [
    "image/jpeg",     // JPEG, JPG
    "image/png",      // PNG
    "image/webp",     // WebP
    "image/avif",     // AVIF
    "image/gif",      // GIF
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

  const originalFilename = filepath.split('/').pop();
  const newFilename = `origin/origin_${originalFilename}`;
  await saveImageToS3(bucketName, newFilename, originalImage, contentType);


  const resizedImage = await resizeImage(originalImage, 'webp', { quality: 85 });
  await uploadFile(bucketName, zippedFilePath, resizedImage, contentType);

  console.log("finish handler");

  return callback(null, zippedFilePath);
};

////////////////////////////////////////////////////////////////////////

async function readTag(bucketName, key) {
  console.log(`start readTag: ${bucketName}/${key}`);

  const s3ObjectTagging = await s3
    .getObjectTagging({ Bucket: bucketName, Key: key })
    .promise();

  console.log(`finish readTag: ${bucketName}/${key}`);

  return s3ObjectTagging.TagSet;
}

async function readImage(bucketName, key) {
  console.log(`start readImage: ${bucketName}/${key}`);

  const s3Object = await s3
    .getObject({ Bucket: bucketName, Key: key })
    .promise();

  console.log(`finish readImage: ${bucketName}/${key}`);

  return s3Object;
}

async function resizeImage(image, format, options) {
  console.log(`start resizeImage`);

  const resizedImage = await sharp(image, {animated: true, failOn: "truncated"})
    .toFormat(format, options)
    .toBuffer();

  console.log(`finish resizeImage`);

  return resizedImage;
}

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
