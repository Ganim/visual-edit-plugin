const secret = process.env.SECRET; // unsafe access
export default { wrapPage: (c) => c, _leaked: secret };
