'use strict';

require('bluebird');

const StorageBase = require('ghost-storage-base'),
    path = require('path'),
    errors = require(path.join(__dirname, 'errors')),
    debug = require('@tryghost/debug')('adapter'),
    cloudinary = require('cloudinary').v2,
    got = require('got'),
    plugins = require(path.join(__dirname, '/plugins'));

class CloudinaryAdapter extends StorageBase {

    /**
     *  @override
     */
    constructor(options) {
        super(options);

        const config = options || {},
            auth = config.auth || config,
            // Kept to avoid a BCB with forked repo
            legacy = config.configuration || {},
            uploadOptions = config.upload || legacy.file || {},
            fetchOptions = config.fetch || legacy.image || {};

        this.useDatedFolder = config.useDatedFolder || false;
        this.plugins = config.plugins || {};
        this.uploaderOptions = {
            upload: uploadOptions,
            fetch: fetchOptions
        };

        debug('constructor:useDatedFolder:', this.useDatedFolder);
        debug('constructor:uploaderOptions:', this.uploaderOptions);
        debug('constructor:plugins:', this.plugins);

        cloudinary.config(auth);
    }

    /**
     *  @override
     */
    exists(filename) {
        debug('exists:filename', filename);

        const pubId = this.toCloudinaryId(filename);

        return new Promise((resolve) => cloudinary.uploader.explicit(pubId, { type: 'upload' }, (err) => {
            if (err) {
                return resolve(false);
            }
            return resolve(true);
        }));
    }

    /**
     *  @override
     */
    save(image) {
        // Creates a deep clone of Cloudinary options
        const uploaderOptions = JSON.parse(JSON.stringify(Object.assign({}, this.uploaderOptions)));

        // Forces the Cloudinary Public ID value based on the file name when upload option
        // "use_filename" is set to true.
        if (uploaderOptions.upload.use_filename !== 'undefined' && uploaderOptions.upload.use_filename) {
            Object.assign(
                uploaderOptions.upload,
                { public_id: path.parse(this.sanitizeFileName(image.name)).name }
            );
        }

        // Appends the dated folder if enabled
        if (this.useDatedFolder) {
            uploaderOptions.upload.folder = this.getTargetDir(uploaderOptions.upload.folder);
        }

        debug('save:uploadOptions:', uploaderOptions);

        // Retinizes images if there is any config provided
        if (this.plugins.retinajs) {
            const retinajs = new plugins.RetinaJS(this.uploader, uploaderOptions, this.plugins.retinajs);
            return retinajs.retinize(image);
        }

        return this.uploader(image.path, uploaderOptions, true);
    }

    /**
     *  Uploads an image with options to Cloudinary
     *  @param {string} imagePath The image path to upload (local or remote)
     *  @param {object} options Cloudinary upload + fetch options
     *  @param {boolean} url If true, will do an extra Cloudinary API call to fetch the uploaded image with fetch options
     *  @return {Promise} The uploader Promise
     */
    uploader(imagePath, options, url) {
        debug('uploader:imagePath', imagePath);
        debug('uploader:options', options);
        debug('uploader:url', url);

        return new Promise((resolve, reject) => cloudinary.uploader.upload(imagePath, options.upload, (err, res) => {
            if (err) {
                debug('cloudinary.uploader:error', err);

                return reject(new errors.CloudinaryAdapterError({
                    err: err,
                    message: `Could not upload image ${imagePath}`
                }));
            }

            debug('cloudinary.uploader:res', res);

            if (url) {
                return resolve(cloudinary.url(res.public_id.concat('.', res.format), options.fetch));
            }
            return resolve();
        }));
    }

    /**
     *  @override
     */
    serve() {
        return (req, res, next) => {
            next();
        };
    }

    /**
     *  @override
     */
    delete(filename) {
        debug('delete:filename', filename);

        const pubId = this.toCloudinaryId(filename);

        return new Promise((resolve, reject) => cloudinary.uploader.destroy(pubId, (err, res) => {
            if (err) {
                debug('delete:error', err);

                return reject(new errors.CloudinaryAdapterError({
                    err: err,
                    message: `Could not delete image ${filename}`
                }));
            }
            return resolve(res);
        }));
    }

    /**
     *  @override
     */
    read(options) {
        const opts = options || {};

        debug('read:opts', opts);

        return new Promise(async (resolve, reject) => {
            try {
                return resolve(await got(opts.path, {
                    responseType: 'buffer',
                    resolveBodyOnly: true
                }));
            } catch (err) {

                debug('read:error', err);

                return reject(new errors.CloudinaryAdapterError({
                    err: err,
                    message: `Could not read image ${opts.path}`
                }));
            }
        });
    }

    /**
     *  Extracts the a Cloudinary-ready file name for API usage.
     *  If a "folder" upload option is set, it will prepend its
     *  value.
     *  @param {string} filename The wanted image filename
     *  @return {string} Cloudinary-ready image name
     */
    toCloudinaryFile(filename) {
        const file = path.parse(filename).base;
        if (typeof this.uploaderOptions.upload.folder !== 'undefined') {
            return path.join(this.uploaderOptions.upload.folder, file);
        }
        return file;
    }

    /**
     *  Returns the Cloudinary public ID off a given filename
     *  @param {string} filename The wanted image filename
     *  @return {string} Cloudinary-ready ID for given image
     */
    toCloudinaryId(filename) {
        const parsed = path.parse(this.toCloudinaryFile(filename));
        return path.join(parsed.dir, parsed.name);
    }
}

module.exports = CloudinaryAdapter;
